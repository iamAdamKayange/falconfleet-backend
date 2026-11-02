import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function migrateDatabase(client) {
  await client.query("SELECT pg_advisory_lock(184731, 1)");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS falconfleet_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL("../database/migrations/", import.meta.url);
    const files = (await readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
      const { rows } = await client.query("SELECT checksum FROM falconfleet_migrations WHERE name=$1", [name]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO falconfleet_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(184731, 1)");
  }
}
