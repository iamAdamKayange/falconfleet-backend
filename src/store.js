import pg from "pg";
import { randomUUID } from "node:crypto";
export function createStore(connectionString, schoolId = "mbeya-pilot") {
  const pool = connectionString
    ? new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000 })
    : null;
  const memory = new Map();
  return {
    kind: pool ? "postgres" : "memory",
    async check() {
      if (pool) await pool.query("SELECT 1 FROM workspace_records LIMIT 1");
    },
    async list(collection) {
      if (!pool) return [...(memory.get(collection) || [])];
      const { rows } = await pool.query(
        "SELECT data FROM workspace_records WHERE school_id=$1 AND collection=$2 ORDER BY created_at DESC",
        [schoolId, collection],
      );
      return rows.map((r) => r.data);
    },
    async create(collection, data) {
      const record = { ...data, id: randomUUID() };
      if (!pool) {
        memory.set(collection, [record, ...(memory.get(collection) || [])]);
        return record;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO workspace_records (school_id,collection,id,data) VALUES ($1,$2,$3,$4)",
          [schoolId, collection, record.id, record],
        );
        await client.query(
          "INSERT INTO workspace_audit (school_id,collection,record_id,action) VALUES ($1,$2,$3,$4)",
          [schoolId, collection, record.id, "created"],
        );
        await client.query("COMMIT");
        return record;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async acknowledge(id) {
      if (!pool) {
        const list = memory.get("alerts") || [];
        const row = list.find((r) => r.id === id);
        if (!row) return null;
        row.status = "Acknowledged";
        return row;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "UPDATE workspace_records SET data=jsonb_set(data,'{status}','\"Acknowledged\"'),updated_at=now() WHERE school_id=$1 AND collection='alerts' AND id=$2 RETURNING data",
          [schoolId, id],
        );
        if (rows.length)
          await client.query(
            "INSERT INTO workspace_audit (school_id,collection,record_id,action) VALUES ($1,$2,$3,$4)",
            [schoolId, "alerts", id, "acknowledged"],
          );
        await client.query("COMMIT");
        return rows[0]?.data || null;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      if (pool) await pool.end();
    },
  };
}
