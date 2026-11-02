import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIdentityStore, hashPassword } from "./identity-store.js";
import { createIdentityRouter } from "./identity-api.js";
import { seedDemo } from "./seed.js";
import { roles } from "./access.js";
import { code } from "./totp.js";
const password = "test-password-at-least-12";
async function fixture(t, secure = false) {
  const store = createIdentityStore();
  await store.init();
  await seedDemo(store, password);
  const origin = secure ? "https://app.example.test" : "http://localhost:3100";
  const app = express();
  app.use(createIdentityRouter(store, { origin, secure }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", data, cookie = "") {
    return fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  async function login(role) {
    const response = await request("/auth/login", "POST", {
      email: `${role}@demo.falconfleet.test`,
      password,
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  return { store, base, request, login };
}
test("all nine roles receive only permitted resources; connections are platform-only", async (t) => {
  const { request, login } = await fixture(t);
  for (const [role, permissions] of Object.entries(roles)) {
    const cookie = await login(role);
    assert.equal(
      (await request("/connections", "GET", undefined, cookie)).status,
      role === "platform_admin" ? 200 : 403,
      role,
    );
    assert.equal(
      (await request("/users", "GET", undefined, cookie)).status,
      permissions.read.includes("users") ? 200 : 403,
      role,
    );
    assert.equal(
      (await request("/records/fuel", "GET", undefined, cookie)).status,
      permissions.read.includes("fuel") ? 200 : 403,
      role,
    );
    assert.equal(
      (
        await request(
          "/records/fuel",
          "POST",
          { name: "Fuel", amount: 10 },
          cookie,
        )
      ).status,
      permissions.write.includes("fuel")
        ? role === "platform_admin"
          ? 400
          : 200
        : 403,
      role,
    );
    assert.equal(
      (
        await request(
          "/auth/role",
          "POST",
          {
            role: role === "platform_admin" ? "school_admin" : "platform_admin",
          },
          cookie,
        )
      ).status,
      403,
    );
  }
});
test("tenant and assignment isolation resist query and ID tampering", async (t) => {
  const { request, login } = await fixture(t);
  const school = await login("school_admin");
  const response = await request(
    "/records/students?schoolId=arusha-demo",
    "GET",
    undefined,
    school,
  );
  assert.deepEqual(
    (await response.json()).data.map((r) => r.id),
    ["demo-student"],
  );
  assert.equal(
    (
      await request(
        "/records/students/other-student",
        "DELETE",
        undefined,
        school,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/users",
        "POST",
        {
          name: "Escalation",
          email: "bad@test.example",
          password,
          roles: ["platform_admin"],
          schoolId: "mbeya-pilot",
        },
        school,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/users",
        "POST",
        {
          name: "Cross tenant",
          email: "cross@test.example",
          password,
          roles: ["driver"],
          schoolId: "arusha-demo",
        },
        school,
      )
    ).status,
    403,
  );
  const driver = await login("driver"),
    guardian = await login("guardian");
  assert.deepEqual(
    (
      await (await request("/records/trips", "GET", undefined, driver)).json()
    ).data.map((r) => r.id),
    ["demo-trip"],
  );
  assert.deepEqual(
    (
      await (await request("/children", "GET", undefined, guardian)).json()
    ).data.map((r) => r.id),
    ["demo-student"],
  );
  assert.equal(
    (await request("/records/students", "GET", undefined, guardian)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/records/trips/demo-trip",
        "PATCH",
        { status: "Completed" },
        driver,
      )
    ).status,
    403,
  );
});
test("boarding notifications go to linked guardian, driver feedback and permitted staff only", async (t) => {
  const { request, login, store } = await fixture(t);
  await store.transaction(async (state) =>
    state.users.push({
      id: "unlinked-parent",
      name: "Other parent",
      email: "other@test.example",
      passwordHash: await hashPassword(password),
      schoolId: "mbeya-pilot",
      roles: ["guardian"],
      active: true,
    }),
  );
  const driver = await login("driver"),
    guardian = await login("guardian"),
    finance = await login("finance_officer");
  assert.equal(
    (
      await request(
        "/boarding/demo-student",
        "POST",
        { tripId: "demo-trip", action: "dropped_off" },
        driver,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/boarding/demo-student",
        "POST",
        { tripId: "demo-trip", action: "onboard" },
        driver,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/boarding/demo-student",
        "POST",
        { tripId: "demo-trip", action: "onboard" },
        driver,
      )
    ).status,
    409,
  );
  const parentMessages = (
    await (await request("/notifications", "GET", undefined, guardian)).json()
  ).data;
  assert.ok(parentMessages.some((n) => n.resource === "children"));
  const financeMessages = (
    await (await request("/notifications", "GET", undefined, finance)).json()
  ).data;
  assert.equal(
    financeMessages.some(
      (n) => n.resource === "trips" || n.resource === "children",
    ),
    false,
  );
  assert.equal(
    (
      await request(
        `/notifications/${parentMessages[0].id}`,
        "PATCH",
        {},
        finance,
      )
    ).status,
    404,
  );
  await request("/notifications", "DELETE", undefined, finance);
  assert.equal(
    (await (await request("/notifications", "GET", undefined, guardian)).json())
      .data.length,
    parentMessages.length,
  );
  const leaked = await store.transaction((state) =>
    state.notifications.filter((n) => n.userId === "unlinked-parent"),
  );
  assert.equal(leaked.length, 0);
});
test("revoking a user invalidates sessions, auditors cannot mutate, and CSRF is denied", async (t) => {
  const { request, login, base } = await fixture(t);
  const school = await login("school_admin"),
    driver = await login("driver"),
    auditor = await login("auditor");
  assert.equal(
    (await request("/records/routes/demo-route", "DELETE", undefined, auditor))
      .status,
    403,
  );
  assert.equal(
    (await request("/users/demo-driver", "PATCH", { active: false }, school))
      .status,
    200,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, driver)).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/auth/logout", {
        method: "POST",
        headers: { Cookie: school, Origin: "https://attacker.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/records/alerts/demo-alert", "DELETE", undefined, school))
      .status,
    403,
  );
  await request("/auth/logout", "POST", {}, school);
  assert.equal(
    (await request("/auth/me", "GET", undefined, school)).status,
    401,
  );
});
test("privileged production sessions are gated by MFA and used codes cannot be replayed", async (t) => {
  const { request, login } = await fixture(t, true);
  const admin = await login("platform_admin");
  assert.equal(
    (await (await request("/auth/me", "GET", undefined, admin)).json())
      .mfaRequired,
    true,
  );
  assert.equal(
    (await request("/connections", "GET", undefined, admin)).status,
    403,
  );
  const setup = await (
    await request("/auth/mfa/setup", "POST", {}, admin)
  ).json();
  assert.ok(setup.secret);
  const otp = code(setup.secret, Math.floor(Date.now() / 30000));
  const verified = await (
    await request("/auth/mfa/verify", "POST", { code: otp }, admin)
  ).json();
  assert.equal(verified.mfaRequired, false);
  assert.equal(
    (await request("/connections", "GET", undefined, admin)).status,
    200,
  );
  const second = await login("platform_admin");
  const replay = await (
    await request("/auth/mfa/verify", "POST", { code: otp }, second)
  ).json();
  assert.ok(replay.error);
  assert.equal(
    (await request("/connections", "GET", undefined, second)).status,
    403,
  );
});
test("one user's roles have independent notification read/delete state", async (t) => {
  const { request, login, store } = await fixture(t);
  await store.transaction((state) => {
    state.users
      .find((u) => u.id === "demo-school_admin")
      .roles.push("finance_officer");
  });
  const admin = await login("school_admin");
  await request(
    "/records/fuel",
    "POST",
    { name: "Test refill", amount: 100 },
    admin,
  );
  const schoolMessages = (
    await (await request("/notifications", "GET", undefined, admin)).json()
  ).data;
  const event = schoolMessages.find((n) => n.resource === "fuel");
  assert.ok(event);
  const markRead = await request(`/notifications/${event.id}`, "PATCH", {}, admin);
  assert.equal((await markRead.json()).data.read, true);
  const markUnread = await request(`/notifications/${event.id}`, "PATCH", { read: false }, admin);
  assert.equal((await markUnread.json()).data.read, false);
  assert.equal((await request(`/notifications/${event.id}`, "PATCH", { read: "false" }, admin)).status, 400);
  await request("/auth/role", "POST", { role: "finance_officer" }, admin);
  const financeMessages = (
    await (await request("/notifications", "GET", undefined, admin)).json()
  ).data;
  assert.ok(financeMessages.some((n) => n.resource === "fuel"));
  assert.equal(
    financeMessages.some((n) => n.id === event.id),
    false,
  );
  await request("/notifications", "DELETE", undefined, admin);
  await request("/auth/role", "POST", { role: "school_admin" }, admin);
  const remaining = (
    await (await request("/notifications", "GET", undefined, admin)).json()
  ).data;
  assert.ok(remaining.some((n) => n.id === event.id));
});
