import { roles } from "./access.js";
import { hashPassword, audit } from "./identity-store.js";

export async function resetAccountPasswords(store, env) {
  const targets = [
    { email: env.ADMIN_EMAIL?.trim().toLowerCase(), role: "platform_admin", key: "ADMIN_PASSWORD" },
    ...Object.keys(roles).filter((role) => role !== "platform_admin").map((role) => ({
      email: `${role}@demo.falconfleet.test`, role, key: `DEMO_${role.toUpperCase()}_PASSWORD`,
    })),
  ];
  const prepared = [];
  for (const target of targets) {
    const password = env[target.key];
    if (!target.email || typeof password !== "string" || password.length < 10 || password.length > 128)
      throw Error(`Set ${target.key} with 10–128 characters and a valid ADMIN_EMAIL`);
    prepared.push({ ...target, passwordHash: await hashPassword(password) });
  }
  return store.transaction((state) => {
    const changed = new Set();
    for (const target of prepared) {
      const user = state.users.find((item) => item.email === target.email);
      if (!user || !user.roles.includes(target.role)) throw Error(`Expected role account not found: ${target.email}`);
      if (target.role !== "platform_admin" && (user.demo !== true || user.schoolId !== "falconfleet-demo"))
        throw Error(`Refusing to reset an unrelated account: ${target.email}`);
      user.passwordHash = target.passwordHash;
      changed.add(user.id);
      audit(state, null, user.schoolId, "operator_password_reset", "users", user.id);
    }
    state.sessions = state.sessions.filter((session) => !changed.has(session.userId));
    return changed.size;
  });
}
