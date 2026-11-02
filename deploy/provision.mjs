import { createIdentityStore } from "../src/identity-store.js";
import { provisionAccounts } from "../src/provision-accounts.js";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const store = createIdentityStore(process.env.DATABASE_URL);
try {
  await store.init();
  const created = await provisionAccounts(store, process.env);
  console.log(`Account provisioning complete: ${created.length} created. Existing accounts preserved.`);
} finally {
  await store.close();
}
