import { createIdentityStore } from "./identity-store.js";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required.");
const store = createIdentityStore(process.env.DATABASE_URL);
try {
  await store.init();
  console.log("Database migrations complete.");
} finally {
  await store.close();
}
