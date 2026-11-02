import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  roles,
  eventRoles,
  safeUser,
  has,
  scope,
  visibleRecords,
} from "./access.js";
import { hashPassword, verifyPassword, audit } from "./identity-store.js";
import { secret as totpSecret, verifyCode } from "./totp.js";
const digest = (token) => createHash("sha256").update(token).digest("hex");
const credential = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(256),
  })
  .strict();
const passwordSchema = z.string().min(10).max(128);
const recordSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    detail: z.string().trim().max(500).default(""),
    status: z.string().max(40).default("Draft"),
    amount: z.number().nonnegative().max(1e9).optional(),
    driverId: z.string().optional(),
    guardianIds: z.array(z.string()).max(4).optional(),
    tripIds: z.array(z.string()).max(2).optional(),
  })
  .strict();
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function notify(state, actor, collection, schoolId, message, targetIds = []) {
  const allowed = new Set(eventRoles[collection] || []);
  const eventId = randomUUID();
  for (const user of state.users.filter((u) => u.active)) {
    const direct = targetIds.includes(user.id) && user.schoolId === schoolId;
    const audiences = user.roles.filter(
      (role) =>
        role === "platform_admin" ||
        (user.schoolId === schoolId && allowed.has(role)) ||
        (direct && role === "driver"),
    );
    if (!audiences.length && user.id === actor.id)
      audiences.push(user.roles[0]);
    for (const role of audiences)
      state.notifications.push({
        id: randomUUID(),
        eventId,
        userId: user.id,
        schoolId,
        message,
        role,
        read: false,
        time: Date.now(),
        resource: collection,
      });
  }
}
export function createIdentityRouter(
  store,
  { origin = "http://localhost:3100", secure = false } = {},
) {
  const router = express.Router();
  const attempts = new Map();
  const cookieName = secure ? "__Host-falconfleet" : "falconfleet-session";
  const needsMfa = (user, session) =>
    secure &&
    ["platform_admin", "school_admin"].includes(session.role) &&
    !session.mfaVerified;
  const sessionData = (user, session) => ({
    user: safeUser(user),
    role: session.role,
    permissions: roles[session.role],
    mfaRequired: needsMfa(user, session),
    mfaEnrolled: !!user.totpSecret,
  });
  router.use(express.json({ limit: "512kb" }));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ error: "Untrusted origin" });
    next();
  });
  router.get("/health", async (_req, res) => {
    try {
      await store.transaction(() => true);
      res.json({ status: "ok", storage: store.kind });
    } catch {
      res.status(503).json({ error: "Database unavailable" });
    }
  });
  router.post("/auth/login", async (req, res) => {
    const body = credential.parse(req.body);
    const key = `${req.ip}:${body.email}`;
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const entry = attempts.get(key) || {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    if (entry.count >= 8)
      fail(429, "Too many attempts. Try again in 15 minutes.");
    entry.count++;
    attempts.set(key, entry);
    const token = randomBytes(32).toString("base64url");
    const result = await store.transaction(async (state) => {
      const user = state.users.find((u) => u.email === body.email && u.active);
      // Same password work for nonexistent accounts.
      const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
      if (
        !(await verifyPassword(body.password, user?.passwordHash || dummy)) ||
        !user
      )
        fail(401, "Invalid email or password");
      const role = user.roles[0];
      state.sessions = state.sessions.filter((s) => s.expires > now);
      const session = {
        hash: digest(token),
        userId: user.id,
        role,
        expires: now + 12 * 60 * 60 * 1000,
        mfaVerified: false,
      };
      state.sessions.push(session);
      audit(state, user, user.schoolId, "login", "auth");
      return sessionData(user, session);
    });
    attempts.delete(key);
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json(result);
  });
  router.use(async (req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!cookie) return res.status(401).json({ error: "Sign in required" });
    const actor = await store.transaction((state) => {
      const session = state.sessions.find(
        (s) => s.hash === digest(cookie) && s.expires > Date.now(),
      );
      const user =
        session &&
        state.users.find(
          (u) =>
            u.id === session.userId &&
            u.active &&
            u.roles.includes(session.role),
        );
      return user ? { user, session } : null;
    });
    if (!actor) return res.status(401).json({ error: "Session expired" });
    if (
      needsMfa(actor.user, actor.session) &&
      ![
        "/auth/me",
        "/auth/logout",
        "/auth/mfa/setup",
        "/auth/mfa/verify",
      ].includes(req.path)
    )
      return res
        .status(403)
        .json({ error: "Complete multifactor authentication first" });
    req.actor = actor;
    next();
  });
  const run = (fn) => async (req, res) =>
    res.json(
      await store.transaction(async (state) => {
        // Recheck inside the same lock as mutations: revocation cannot race a request.
        const session = state.sessions.find(
          (s) => s.hash === req.actor.session.hash && s.expires > Date.now(),
        );
        const user =
          session &&
          state.users.find(
            (u) =>
              u.id === session.userId &&
              u.active &&
              u.roles.includes(session.role),
          );
        if (!user) fail(401, "Session expired");
        if (
          needsMfa(user, session) &&
          ![
            "/auth/me",
            "/auth/logout",
            "/auth/mfa/setup",
            "/auth/mfa/verify",
          ].includes(req.path)
        )
          fail(403, "Complete multifactor authentication first");
        return fn(req, state, user, session);
      }),
    );
  const authorize = (session, action, resource) => {
    if (!has(session, action, resource)) fail(403, "Permission denied");
  };
  router.get(
    "/auth/me",
    run((_req, _state, user, session) => sessionData(user, session)),
  );
  router.post(
    "/auth/logout",
    run((_req, state, user, session) => {
      state.sessions = state.sessions.filter((s) => s.hash !== session.hash);
      audit(state, user, user.schoolId, "logout", "auth");
      return { ok: true };
    }),
  );
  router.post(
    "/auth/role",
    run((req, state, user, session) => {
      if (!user.roles.includes(req.body.role)) fail(403, "Role not granted");
      session.role = req.body.role;
      session.mfaVerified = false;
      audit(state, user, user.schoolId, "switch_role", "auth");
      return sessionData(user, session);
    }),
  );
  router.post(
    "/auth/mfa/setup",
    run((_req, _state, user, session) => {
      if (user.totpSecret) fail(409, "MFA is already enrolled");
      session.pendingTotp ||= totpSecret();
      return {
        secret: session.pendingTotp,
        issuer: "FalconFleet",
        account: user.email,
      };
    }),
  );
  router.post(
    "/auth/mfa/verify",
    run((req, state, user, session) => {
      const input = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body);
      session.mfaAttempts = (session.mfaAttempts || 0) + 1;
      if (session.mfaAttempts > 8) {
        session.expires = 0;
        return { error: "MFA attempts exceeded; sign in again" };
      }
      const seed = user.totpSecret || session.pendingTotp;
      if (!seed) fail(400, "Enroll MFA first");
      const step = verifyCode(seed, input.code, user.lastTotpStep ?? -1);
      if (step === null) return { error: "Invalid or previously used code" };
      user.totpSecret = seed;
      user.lastTotpStep = step;
      session.mfaVerified = true;
      delete session.pendingTotp;
      audit(state, user, user.schoolId, "mfa_verified", "auth");
      return sessionData(user, session);
    }),
  );
  router.patch(
    "/profile",
    run((req, state, user) => {
      const data = z
        .object({
          name: z.string().trim().min(1).max(80),
          phone: z.string().max(30),
          bio: z.string().max(300),
          photo: z
            .string()
            .max(350000)
            .refine(
              (v) =>
                !v ||
                /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
            ),
        })
        .strict()
        .parse(req.body);
      Object.assign(user, data);
      audit(state, user, user.schoolId, "profile_updated", "profile");
      state.notifications.push({
        id: randomUUID(),
        userId: user.id,
        schoolId: user.schoolId,
        role: null,
        message: "Profile updated.",
        read: false,
        time: Date.now(),
        resource: "profile",
      });
      return { user: safeUser(user) };
    }),
  );
  router.get(
    "/schools",
    run((_req, state, user, session) => ({
      data: state.schools.filter(
        (s) => session.role === "platform_admin" || s.id === user.schoolId,
      ),
    })),
  );
  router.post(
    "/schools",
    run((req, state, user, session) => {
      authorize(session, "write", "schools");
      const data = z
        .object({ name: z.string().trim().min(1).max(100) })
        .strict()
        .parse(req.body);
      const school = { id: randomUUID(), name: data.name };
      state.schools.push(school);
      audit(state, user, school.id, "created", "schools", school.id);
      notify(
        state,
        user,
        "schools",
        school.id,
        `School created: ${school.name}`,
      );
      return { data: school };
    }),
  );
  router.get(
    "/roles",
    run((_req, _state, _user, session) => {
      authorize(session, "read", "users");
      return {
        data: Object.entries(roles)
          .filter(
            ([id]) =>
              session.role === "platform_admin" || id !== "platform_admin",
          )
          .map(([id, r]) => ({ id, ...r })),
      };
    }),
  );
  router.get(
    "/assignment-options",
    run((req, state, user, session) => {
      if (!has(session, "write", "students") && !has(session, "write", "trips"))
        fail(403, "Permission denied");
      const schoolId = scope(user, session, req.query.schoolId);
      if (!schoolId) return { drivers: [], guardians: [], trips: [] };
      const candidates = state.users.filter(
        (u) => u.active && u.schoolId === schoolId,
      );
      return {
        drivers: candidates
          .filter((u) => u.roles.includes("driver"))
          .map((u) => ({ id: u.id, name: u.name })),
        guardians: has(session, "write", "students")
          ? candidates
              .filter((u) => u.roles.includes("guardian"))
              .map((u) => ({ id: u.id, name: u.name }))
          : [],
        trips: state.records
          .filter((r) => r.schoolId === schoolId && r.collection === "trips")
          .map((r) => ({ id: r.id, name: r.name })),
      };
    }),
  );
  router.get(
    "/users",
    run((req, state, user, session) => {
      authorize(session, "read", "users");
      const schoolId = scope(user, session, req.query.schoolId);
      return {
        data: state.users
          .filter((u) => !schoolId || u.schoolId === schoolId)
          .map(safeUser),
      };
    }),
  );
  router.post(
    "/users",
    run(async (req, state, user, session) => {
      authorize(session, "write", "users");
      const data = z
        .object({
          name: z.string().trim().min(1).max(80),
          email: z
            .string()
            .email()
            .transform((v) => v.toLowerCase()),
          password: passwordSchema,
          roles: z
            .array(z.enum(Object.keys(roles)))
            .min(1)
            .max(9),
          schoolId: z.string().nullable(),
        })
        .strict()
        .parse(req.body);
      if (
        session.role !== "platform_admin" &&
        (data.roles.includes("platform_admin") ||
          data.schoolId !== user.schoolId)
      )
        fail(403, "Cannot grant platform access or access to another school");
      if (
        !data.roles.includes("platform_admin") &&
        !state.schools.some((s) => s.id === data.schoolId)
      )
        fail(400, "Select a valid school");
      if (data.roles.includes("platform_admin") && data.roles.length !== 1)
        fail(400, "Platform admin must use a separate platform account");
      if (state.users.some((u) => u.email === data.email))
        fail(409, "Account already exists");
      const created = {
        id: randomUUID(),
        ...data,
        passwordHash: await hashPassword(data.password),
        active: true,
      };
      delete created.password;
      state.users.push(created);
      audit(state, user, created.schoolId, "user_created", "users", created.id);
      notify(
        state,
        user,
        "users",
        created.schoolId,
        `User account created: ${created.name}`,
      );
      return { data: safeUser(created) };
    }),
  );
  router.patch(
    "/users/:id",
    run((req, state, user, session) => {
      authorize(session, "write", "users");
      const target = state.users.find(
        (u) =>
          u.id === req.params.id &&
          (session.role === "platform_admin" || u.schoolId === user.schoolId),
      );
      if (!target) fail(404, "User not found");
      if (target.id === user.id) fail(400, "Cannot change your own access");
      if (
        session.role !== "platform_admin" &&
        target.roles.includes("platform_admin")
      )
        fail(403, "Permission denied");
      const data = z
        .object({
          active: z.boolean().optional(),
          roles: z
            .array(z.enum(Object.keys(roles)))
            .min(1)
            .max(9)
            .optional(),
        })
        .strict()
        .refine((v) => v.active !== undefined || v.roles !== undefined)
        .parse(req.body);
      if (
        data.roles?.includes("platform_admin") &&
        session.role !== "platform_admin"
      )
        fail(403, "Cannot grant platform access");
      if (data.roles?.includes("platform_admin") && data.roles.length !== 1)
        fail(400, "Platform admin must use a separate platform account");
      if (
        data.roles &&
        !data.roles.includes("platform_admin") &&
        !target.schoolId
      )
        fail(400, "School roles require a school-scoped account");
      if (
        (data.active === false ||
          (data.roles && !data.roles.includes("platform_admin"))) &&
        target.roles.includes("platform_admin") &&
        state.users.filter(
          (u) => u.active && u.roles.includes("platform_admin"),
        ).length < 2
      )
        fail(400, "Cannot remove the last platform administrator");
      if (data.active !== undefined) target.active = data.active;
      if (data.roles) target.roles = [...new Set(data.roles)];
      state.sessions = state.sessions.filter((s) => s.userId !== target.id);
      audit(
        state,
        user,
        target.schoolId,
        data.roles
          ? "roles_changed"
          : data.active
            ? "user_enabled"
            : "user_disabled",
        "users",
        target.id,
      );
      notify(
        state,
        user,
        "users",
        target.schoolId,
        `User access updated: ${target.name}`,
      );
      return { data: safeUser(target) };
    }),
  );
  router.get(
    "/records/:collection",
    run((req, state, user, session) => {
      authorize(session, "read", req.params.collection);
      return {
        data: visibleRecords(
          state,
          user,
          session,
          req.params.collection,
          scope(user, session, req.query.schoolId),
        ),
      };
    }),
  );
  router.post(
    "/records/:collection",
    run((req, state, user, session) => {
      const collection = req.params.collection;
      authorize(session, "write", collection);
      if (["users", "schools", "connections", "boarding"].includes(collection))
        fail(400, "Use the dedicated endpoint");
      const data = recordSchema.parse(req.body),
        schoolId = scope(user, session, req.query.schoolId);
      if (!schoolId || !state.schools.some((s) => s.id === schoolId))
        fail(400, "Select a school first");
      if (
        data.driverId &&
        !state.users.some(
          (u) =>
            u.id === data.driverId &&
            u.schoolId === schoolId &&
            u.active &&
            u.roles.includes("driver"),
        )
      )
        fail(400, "Invalid driver assignment");
      if (
        data.guardianIds?.some(
          (id) =>
            !state.users.some(
              (u) =>
                u.id === id &&
                u.schoolId === schoolId &&
                u.active &&
                u.roles.includes("guardian"),
            ),
        )
      )
        fail(400, "Invalid guardian link");
      if (
        data.tripIds?.some(
          (id) =>
            !state.records.some(
              (r) =>
                r.id === id &&
                r.collection === "trips" &&
                r.schoolId === schoolId,
            ),
        )
      )
        fail(400, "Invalid trip assignment");
      const record = {
        id: randomUUID(),
        schoolId,
        collection,
        ...data,
        createdAt: Date.now(),
      };
      state.records.push(record);
      audit(state, user, schoolId, "created", collection, record.id);
      notify(
        state,
        user,
        collection,
        schoolId,
        `${collection}: ${record.name} created.`,
        data.driverId ? [data.driverId] : [],
      );
      return { data: record };
    }),
  );
  router.patch(
    "/records/:collection/:id",
    run((req, state, user, session) => {
      const collection = req.params.collection;
      authorize(session, "write", collection);
      const record = state.records.find(
        (r) =>
          r.id === req.params.id &&
          r.collection === collection &&
          (!scope(user, session, req.query.schoolId) ||
            r.schoolId === scope(user, session, req.query.schoolId)),
      );
      if (!record) fail(404, "Record not found");
      const data = z
        .object({
          status: z.enum([
            "Acknowledged",
            "In progress",
            "Completed",
            "Approved",
            "In repair",
            "Resolved",
          ]),
        })
        .strict()
        .parse(req.body);
      record.status = data.status;
      audit(
        state,
        user,
        record.schoolId,
        "status_changed",
        collection,
        record.id,
      );
      notify(
        state,
        user,
        collection,
        record.schoolId,
        `${collection}: ${record.name} → ${record.status}`,
        record.driverId ? [record.driverId] : [],
      );
      return { data: record };
    }),
  );
  router.delete(
    "/records/:collection/:id",
    run((req, state, user, session) => {
      const collection = req.params.collection;
      authorize(session, "write", collection);
      if (["alerts", "trips", "fuel", "maintenance"].includes(collection))
        fail(
          403,
          "Auditable operational records cannot be deleted; update status instead",
        );
      const record = state.records.find(
        (r) =>
          r.id === req.params.id &&
          r.collection === collection &&
          (!scope(user, session, req.query.schoolId) ||
            r.schoolId === scope(user, session, req.query.schoolId)),
      );
      if (!record) fail(404, "Record not found");
      state.records = state.records.filter((r) => r.id !== record.id);
      audit(state, user, record.schoolId, "deleted", collection, record.id);
      notify(
        state,
        user,
        collection,
        record.schoolId,
        `${collection}: ${record.name} deleted.`,
      );
      return { ok: true };
    }),
  );
  router.get(
    "/children",
    run((_req, state, user, session) => {
      if (session.role !== "guardian") fail(403, "Guardian access only");
      return {
        data: state.records
          .filter(
            (r) =>
              r.schoolId === user.schoolId &&
              r.collection === "students" &&
              r.guardianIds?.includes(user.id),
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            boarding: r.boarding || "Not recorded",
            trips: state.records
              .filter(
                (trip) =>
                  trip.schoolId === user.schoolId &&
                  trip.collection === "trips" &&
                  r.tripIds?.includes(trip.id),
              )
              .map((trip) => ({
                id: trip.id,
                name: trip.name,
                status: trip.status,
              })),
          })),
      };
    }),
  );
  router.post(
    "/boarding/:studentId",
    run((req, state, user, session) => {
      if (!has(session, "write", "boarding"))
        fail(403, "Driver boarding access only");
      const { tripId, action } = z
        .object({
          tripId: z.string(),
          action: z.enum(["onboard", "dropped_off"]),
        })
        .strict()
        .parse(req.body);
      const trip = state.records.find(
        (r) =>
          r.id === tripId &&
          r.collection === "trips" &&
          r.schoolId === user.schoolId &&
          r.driverId === user.id &&
          r.status === "In progress",
      );
      const student = state.records.find(
        (r) =>
          r.id === req.params.studentId &&
          r.collection === "students" &&
          r.schoolId === user.schoolId &&
          r.tripIds?.includes(tripId),
      );
      if (!trip || !student)
        fail(404, "Assigned active trip or pupil not found");
      student.boardingByTrip ||= {};
      const previous = student.boardingByTrip[tripId];
      if (
        (action === "onboard" && previous) ||
        (action === "dropped_off" && previous !== "onboard")
      )
        fail(409, "Invalid boarding transition");
      student.boardingByTrip[tripId] = action;
      student.boarding = action;
      audit(state, user, user.schoolId, action, "boarding", student.id);
      notify(
        state,
        user,
        "trips",
        user.schoolId,
        `Boarding recorded: ${student.name} ${action}.`,
      );
      for (const id of student.guardianIds || [])
        if (
          state.users.some(
            (u) =>
              u.id === id &&
              u.schoolId === user.schoolId &&
              u.active &&
              u.roles.includes("guardian"),
          )
        )
          state.notifications.push({
            id: randomUUID(),
            userId: id,
            schoolId: user.schoolId,
            role: "guardian",
            resource: "children",
            message: `${student.name}: ${action} recorded on ${trip.name}.`,
            read: false,
            time: Date.now(),
          });
      return { ok: true };
    }),
  );
  const ownNotices = (state, user, session) =>
    state.notifications.filter(
      (n) =>
        n.userId === user.id &&
        (n.role === null || n.role === session.role) &&
        (session.role === "platform_admin" || n.schoolId === user.schoolId),
    );
  router.get(
    "/notifications",
    run((_req, state, user, session) => ({
      data: ownNotices(state, user, session).sort((a, b) => b.time - a.time),
    })),
  );
  router.patch(
    "/notifications/:id",
    run((req, state, user, session) => {
      const n = ownNotices(state, user, session).find(
        (n) => n.id === req.params.id,
      );
      if (!n) fail(404, "Message not found");
      const { read } = z.object({ read: z.boolean().default(true) }).strict().parse(req.body || {});
      n.read = read;
      return { data: n };
    }),
  );
  router.post(
    "/notifications/read-all",
    run((_req, state, user, session) => {
      ownNotices(state, user, session).forEach((n) => (n.read = true));
      return { ok: true };
    }),
  );
  router.delete(
    "/notifications/:id",
    run((req, state, user, session) => {
      const n = ownNotices(state, user, session).find(
        (n) => n.id === req.params.id,
      );
      if (!n) fail(404, "Message not found");
      state.notifications = state.notifications.filter(
        (item) => item.id !== n.id,
      );
      audit(
        state,
        user,
        user.schoolId,
        "notification_deleted",
        "notifications",
        n.id,
      );
      return { ok: true };
    }),
  );
  router.delete(
    "/notifications",
    run((_req, state, user, session) => {
      const ids = new Set(ownNotices(state, user, session).map((n) => n.id));
      state.notifications = state.notifications.filter((n) => !ids.has(n.id));
      audit(
        state,
        user,
        user.schoolId,
        "notifications_cleared",
        "notifications",
      );
      return { ok: true };
    }),
  );
  router.get(
    "/audit",
    run((req, state, user, session) => {
      authorize(session, "read", "audit");
      const schoolId = scope(user, session, req.query.schoolId);
      return {
        data: state.audit
          .filter((a) => !schoolId || a.schoolId === schoolId)
          .slice(-500)
          .reverse(),
      };
    }),
  );
  router.get(
    "/summary",
    run((req, state, user, session) => {
      const schoolId = scope(user, session, req.query.schoolId);
      const counts = {};
      for (const resource of roles[session.role].read.filter(
        (r) =>
          !["connections", "users", "schools", "audit", "children"].includes(r),
      ))
        counts[resource] = visibleRecords(
          state,
          user,
          session,
          resource,
          schoolId,
        ).length;
      return {
        counts,
        schoolCount:
          session.role === "platform_admin" ? state.schools.length : undefined,
        userCount: has(session, "read", "users")
          ? state.users.filter((u) => !schoolId || u.schoolId === schoolId)
              .length
          : undefined,
        unread: ownNotices(state, user, session).filter((n) => !n.read).length,
      };
    }),
  );
  router.get(
    "/connections",
    run((_req, state, _user, session) => {
      authorize(session, "read", "connections");
      return { data: { ...state.connections, database: store.kind } };
    }),
  );
  router.use(async (err, req, res, _next) => {
    if ([401, 403, 404].includes(err.status))
      try {
        await store.transaction((state) => {
          const actor = req.actor?.user;
          audit(
            state,
            actor,
            actor?.schoolId || null,
            err.status === 401 ? "authentication_failed" : "access_denied",
            "security",
          );
        });
      } catch {}
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: "Invalid input",
          issues: err.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "Request too large" });
    console.error("Identity API error:", err.code || err.name);
    res.status(500).json({ error: "Request failed" });
  });
  return router;
}
