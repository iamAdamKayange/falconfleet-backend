import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentityStore, verifyPassword } from "./identity-store.js";
import { provisionAccounts } from "./provision-accounts.js";
import { roles } from "./access.js";

function environment() {
  return {
    BOOTSTRAP_ADMIN: "true", ADMIN_NAME: "Adam Kayange", ADMIN_EMAIL: "adamkayange223@gmail.com",
    ADMIN_PASSWORD: "test-admin-password-123", SEED_DEMO_ACCOUNTS: "true",
    ...Object.fromEntries(Object.keys(roles).filter((role) => role !== "platform_admin")
      .map((role) => [`DEMO_${role.toUpperCase()}_PASSWORD`, `test-${role}-password-123`])),
  };
}
test("provision creates admin plus eight isolated demo roles and preserves changes on redeploy", async () => {
  const store = createIdentityStore();
  const env = environment();
  assert.equal((await provisionAccounts(store, env)).length, 9);
  const before = await store.transaction((state) => structuredClone(state));
  const admin = before.users.find((user) => user.roles.includes("platform_admin"));
  assert.equal(admin.email, "adamkayange223@gmail.com");
  assert.equal(admin.schoolId, null);
  assert.ok(await verifyPassword(env.ADMIN_PASSWORD, admin.passwordHash));
  for (const user of before.users.filter((user) => user.demo)) {
    assert.equal(user.schoolId, "falconfleet-demo");
    assert.ok(await verifyPassword(env[`DEMO_${user.roles[0].toUpperCase()}_PASSWORD`], user.passwordHash));
  }
  await store.transaction((state) => {
    const user = state.users.find((user) => user.roles.includes("driver"));
    user.active = false;
    user.name = "Changed by operator";
  });
  assert.deepEqual(await provisionAccounts(store, { ...env, ADMIN_PASSWORD: "replacement-password" }), []);
  const after = await store.transaction((state) => structuredClone(state));
  assert.equal(after.users.length, 9);
  assert.equal(after.notifications.length, 8);
  assert.equal(after.users.find((user) => user.roles.includes("driver")).active, false);
  assert.equal(after.users.find((user) => user.id === admin.id).passwordHash, admin.passwordHash);
});
test("invalid demo password rolls back all account creation", async () => {
  const store = createIdentityStore();
  await assert.rejects(provisionAccounts(store, { ...environment(), DEMO_DRIVER_PASSWORD: "short" }), /DEMO_DRIVER_PASSWORD/);
  const state = await store.transaction((state) => structuredClone(state));
  assert.equal(state.users.length, 0);
  assert.equal(state.schools.length, 0);
  assert.equal(state.notifications.length, 0);
});
test("provisioning is opt in and never adopts an existing unrelated email", async () => {
  const store = createIdentityStore();
  assert.deepEqual(await provisionAccounts(store, {}), []);
  await store.transaction((state) => state.users.push({ id: "existing", email: "driver@demo.falconfleet.test", roles: ["driver"] }));
  await assert.rejects(provisionAccounts(store, environment()), /already belongs/);
  assert.equal((await store.transaction((state) => state.users.length)), 1);
});
