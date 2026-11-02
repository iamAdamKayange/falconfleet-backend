import pg from "pg";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(
    await readFile(
      new URL("../database/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log("Migration complete.");
} finally {
  await client.end();
}
