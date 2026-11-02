import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";
import { roles } from "../src/access.js";
import { createIdentityStore } from "../src/identity-store.js";
import { provisionAccounts } from "../src/provision-accounts.js";
import { resetAccountPasswords } from "../src/reset-account-passwords.js";

if (process.getuid && process.getuid() !== 0) throw Error("Run as root");
const password = process.env.ACCOUNT_PASSWORD;
if (!password || password.length < 10 || password.length > 128)
  throw Error("Provide ACCOUNT_PASSWORD with 10–128 characters");
const path = "/etc/falconfleet/api.env";
let text = await readFile(path, "utf8");
const updates = {
  BOOTSTRAP_ADMIN: "true", ADMIN_NAME: "Adam Kayange", ADMIN_EMAIL: "adamkayange223@gmail.com",
  SEED_DEMO_ACCOUNTS: "true", ADMIN_PASSWORD: password,
  ...Object.fromEntries(Object.keys(roles).filter((role) => role !== "platform_admin")
    .map((role) => [`DEMO_${role.toUpperCase()}_PASSWORD`, password])),
};
const env = { ...parseEnv(text), ...updates };
if (!env.DATABASE_URL) throw Error("DATABASE_URL is required in the private env file");
const store = createIdentityStore(env.DATABASE_URL);
try {
  await store.init();
  await provisionAccounts(store, env);
  const count = await resetAccountPasswords(store, env);
  for (const [key, value] of Object.entries(updates)) {
    text = text.replace(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, "gm"), "");
    text += `${text.endsWith("\n") ? "" : "\n"}${key}=${JSON.stringify(value)}\n`;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
  // Preserve access by the falconfleet service group created by the installer.
  const { chown, stat } = await import("node:fs/promises");
  // The installer owns the directory as root:falconfleet.
  const directory = await stat("/etc/falconfleet");
  await chown(path, 0, directory.gid);
  await chmod(path, 0o640);
  console.log(`${count} account passwords updated in PostgreSQL and the private env file. Existing sessions revoked; MFA and disabled status preserved.`);
} finally {
  await store.close();
}
