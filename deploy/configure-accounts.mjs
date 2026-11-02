import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { roles } from "../src/access.js";

if (process.getuid && process.getuid() !== 0) throw Error("Run as root");
const path = "/etc/falconfleet/api.env";
let text = await readFile(path, "utf8");
const current = parseEnv(text);
const updates = {
  BOOTSTRAP_ADMIN: "true",
  ADMIN_NAME: "Adam Kayange",
  ADMIN_EMAIL: "adamkayange223@gmail.com",
  SEED_DEMO_ACCOUNTS: "true",
};
for (const field of ["ADMIN_PASSWORD", ...Object.keys(roles)
  .filter((role) => role !== "platform_admin")
  .map((role) => `DEMO_${role.toUpperCase()}_PASSWORD`)]) {
  const value = current[field] || randomBytes(24).toString("base64url");
  if (value.length < 10 || value.length > 128)
    throw Error(`${field} must have 10–128 characters. Edit the private env file and rerun.`);
  updates[field] = value;
}
for (const [key, value] of Object.entries(updates)) {
  text = text.replace(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, "gm"), "");
  text += `${text.endsWith("\n") ? "" : "\n"}${key}=${JSON.stringify(value)}\n`;
}
const temporary = `${path}.${process.pid}.tmp`;
await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
await rename(temporary, path);
await chmod(path, 0o600);
console.log("Admin identity and eight demo role passwords configured privately in /etc/falconfleet/api.env.");
console.log("Use nano /etc/falconfleet/api.env to view passwords. Existing nonempty passwords were preserved.");
