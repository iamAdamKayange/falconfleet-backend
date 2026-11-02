import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentityStore, verifyPassword } from "./identity-store.js";
import { roles } from "./access.js";
import { provisionAccounts } from "./provision-accounts.js";
import { resetAccountPasswords } from "./reset-account-passwords.js";

const environment = (password) => ({
  BOOTSTRAP_ADMIN: "true", ADMIN_EMAIL: "adamkayange223@gmail.com", ADMIN_NAME: "Adam Kayange",
  ADMIN_PASSWORD: password, SEED_DEMO_ACCOUNTS: "true",
  ...Object.fromEntries(Object.keys(roles).filter((role) => role !== "platform_admin")
    .map((role) => [`DEMO_${role.toUpperCase()}_PASSWORD`, password])),
});
test("explicit password reset changes all nine hashes, revokes sessions and retains MFA and disabled status", async () => {
  const store = createIdentityStore();
  await provisionAccounts(store, environment("old-test-password"));
  await store.transaction((state) => {
    state.users[0].totpSecret = "keep-mfa";
    state.users[1].active = false;
    state.sessions = state.users.map((user) => ({ userId: user.id }));
    state.sessions.push({ userId: "unrelated-user" });
  });
  assert.equal(await resetAccountPasswords(store, environment("new-test-password")), 9);
  const state = await store.transaction((state) => structuredClone(state));
  for (const user of state.users) assert.ok(await verifyPassword("new-test-password", user.passwordHash));
  assert.equal(state.users[0].totpSecret, "keep-mfa");
  assert.equal(state.users[1].active, false);
  assert.deepEqual(state.sessions, [{ userId: "unrelated-user" }]);
});
test("password reset rolls back when a target is missing or belongs to another school", async () => {
  const store = createIdentityStore();
  await provisionAccounts(store, environment("old-test-password"));
  await store.transaction((state) => { state.users.at(-1).schoolId = "another-school"; });
  await assert.rejects(resetAccountPasswords(store, environment("new-test-password")), /unrelated account/);
  const state = await store.transaction((state) => structuredClone(state));
  assert.ok(await verifyPassword("old-test-password", state.users[0].passwordHash));
  assert.equal(state.audit.some((event) => event.action === "operator_password_reset"), false);
});
