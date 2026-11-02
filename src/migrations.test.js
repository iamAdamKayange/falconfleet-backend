import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateDatabase } from "./migrations.js";

function clientFixture() {
  const applied = new Map();
  const queries = [];
  return {
    applied, queries, failSql: false,
    async query(sql, params) {
      queries.push(sql);
      if (sql.startsWith("SELECT checksum")) return { rows: applied.has(params[0]) ? [{ checksum: applied.get(params[0]) }] : [] };
      if (sql.startsWith("INSERT INTO falconfleet_migrations")) applied.set(params[0], params[1]);
      if (this.failSql && sql.startsWith("CREATE TABLE IF NOT EXISTS falconfleet_identity")) throw Error("DDL failed");
      return { rows: [] };
    },
  };
}
test("migrations record checksums, skip repeats and reject changed applied files", async () => {
  const client = clientFixture();
  await migrateDatabase(client);
  assert.equal(client.applied.size, 1);
  assert.ok(client.queries.includes("COMMIT"));
  client.queries.length = 0;
  await migrateDatabase(client);
  assert.equal(client.queries.includes("BEGIN"), false);
  client.applied.set("001_identity.sql", "wrong-checksum");
  await assert.rejects(migrateDatabase(client), /Applied migration changed/);
  assert.equal(client.queries.at(-1), "SELECT pg_advisory_unlock(184731, 1)");
});
test("failed DDL rolls back and releases the migration lock without recording success", async () => {
  const client = clientFixture();
  client.failSql = true;
  await assert.rejects(migrateDatabase(client), /DDL failed/);
  assert.ok(client.queries.includes("ROLLBACK"));
  assert.equal(client.applied.size, 0);
  assert.equal(client.queries.at(-1), "SELECT pg_advisory_unlock(184731, 1)");
});
