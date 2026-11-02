import { randomUUID } from "node:crypto";
import { roles } from "./access.js";
import { audit, hashPassword } from "./identity-store.js";

export async function provisionAccounts(store, env) {
  const ensurePassword = (value, field) => {
    if (typeof value !== "string" || value.length < 10 || value.length > 128)
      throw Error(`${field} requires 10–128 characters; set it privately on the server`);
    return value;
  };
  return store.transaction(async (state) => {
    const created = [];
    if (env.BOOTSTRAP_ADMIN === "true" && !state.users.some((user) => user.roles.includes("platform_admin"))) {
      const email = env.ADMIN_EMAIL?.trim().toLowerCase();
      const name = env.ADMIN_NAME?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name)
        throw Error("Set valid ADMIN_EMAIL and ADMIN_NAME");
      if (state.users.some((user) => user.email === email)) throw Error("Admin email already belongs to another account");
      const user = {
        id: randomUUID(), email, name, roles: ["platform_admin"], schoolId: null, active: true,
        passwordHash: await hashPassword(ensurePassword(env.ADMIN_PASSWORD, "ADMIN_PASSWORD")),
      };
      state.users.push(user);
      audit(state, user, null, "bootstrap", "users", user.id);
      created.push("platform_admin");
    }
    if (env.SEED_DEMO_ACCOUNTS === "true") {
      const schoolId = "falconfleet-demo";
      let school = state.schools.find((item) => item.id === schoolId);
      if (school && school.demo !== true) throw Error("Demo school ID belongs to an existing school");
      if (!school) {
        school = { id: schoolId, name: "FalconFleet Demo School", demo: true };
        state.schools.push(school);
      }
      for (const role of Object.keys(roles).filter((role) => role !== "platform_admin")) {
        const email = `${role}@demo.falconfleet.test`;
        const existing = state.users.find((user) => user.email === email);
        if (existing) {
          if (existing.demo !== true || existing.schoolId !== schoolId)
            throw Error(`Demo email already belongs to another account: ${email}`);
          continue; // Never reset passwords, roles, MFA or disabled status on redeploy.
        }
        const field = `DEMO_${role.toUpperCase()}_PASSWORD`;
        const user = {
          id: randomUUID(), email, name: `${roles[role].label} · Demo`,
          roles: [role], schoolId, active: true, demo: true,
          passwordHash: await hashPassword(ensurePassword(env[field], field)),
        };
        state.users.push(user);
        state.notifications.push({
          id: randomUUID(), userId: user.id, schoolId, role, resource: "system",
          message: "Welcome to FalconFleet Demo School. This account is for demonstration only.",
          read: false, time: Date.now(),
        });
        audit(state, null, schoolId, "demo_account_created", "users", user.id);
        created.push(role);
      }
    }
    return created;
  });
}
