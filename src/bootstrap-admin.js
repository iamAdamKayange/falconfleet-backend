import { randomUUID } from "node:crypto";
import { createIdentityStore, hashPassword, audit } from "./identity-store.js";
if (
  !process.env.DATABASE_URL ||
  !process.env.ADMIN_EMAIL ||
  !process.env.ADMIN_NAME ||
  !process.env.ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD.length < 10
)
  throw Error(
    "Set DATABASE_URL, ADMIN_EMAIL, ADMIN_NAME and a 10+ character ADMIN_PASSWORD privately in the server environment",
  );
const store = createIdentityStore(process.env.DATABASE_URL);
await store.init();
try {
  const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
  await store.transaction((state) => {
    if (state.users.some((u) => u.roles.includes("platform_admin")))
      throw Error("Platform admin already exists; use account management");
    const user = {
      id: randomUUID(),
      email: process.env.ADMIN_EMAIL.toLowerCase(),
      name: process.env.ADMIN_NAME,
      passwordHash,
      roles: ["platform_admin"],
      schoolId: null,
      active: true,
    };
    state.users.push(user);
    audit(state, user, null, "bootstrap", "users", user.id);
  });
  console.log(
    "Platform administrator created. No demo accounts were installed.",
  );
} finally {
  await store.close();
}
