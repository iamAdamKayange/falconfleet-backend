import pg from "pg";
import {
  randomUUID,
  scrypt as scryptCallback,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { migrateDatabase } from "./migrations.js";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${Buffer.from(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(":");
  const candidate = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(key || "", "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(candidate, expected)
  );
}
export const emptyState = () => ({
  users: [],
  sessions: [],
  schools: [],
  records: [],
  notifications: [],
  audit: [],
  connections: {
    gps: "Not connected",
    sms: "Not connected",
    database: "PostgreSQL",
  },
});
// A locked aggregate makes account, audit and recipient writes atomic for the initial pilot.
// PostgreSQL is mandatory in production; there is no silent memory fallback.
export function createIdentityStore(connectionString) {
  let verifiedConnection = connectionString;
  if (connectionString) {
    const url = new URL(connectionString);
    url.searchParams.set("sslmode", "verify-full");
    verifiedConnection = url.toString();
  }
  const pool = connectionString
    ? new pg.Pool({
        connectionString: verifiedConnection,
        enableChannelBinding: true,
        max: 5,
        connectionTimeoutMillis: 10000,
      })
    : null;
  let state = emptyState(),
    queue = Promise.resolve();
  return {
    kind: pool ? "postgres" : "memory",
    async init() {
      if (pool) {
        const client = await pool.connect();
        try {
          await migrateDatabase(client);
        } finally {
          client.release();
        }
        await pool.query(
          "INSERT INTO falconfleet_identity(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING",
          [emptyState()],
        );
      }
    },
    async transaction(fn) {
      if (!pool) {
        const run = queue.then(async () => {
          const copy = structuredClone(state);
          const result = await fn(copy);
          state = copy;
          return result;
        });
        queue = run.catch(() => {});
        return run;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          "SELECT data FROM falconfleet_identity WHERE id=1 FOR UPDATE",
        );
        const result = await fn(rows[0].data);
        await client.query(
          "UPDATE falconfleet_identity SET data=$1 WHERE id=1",
          [rows[0].data],
        );
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (pool) await pool.end();
    },
  };
}
export function audit(state, actor, schoolId, action, resource, recordId = "") {
  state.audit.push({
    id: randomUUID(),
    actorId: actor?.id || "system",
    actorName: actor?.name || "System",
    schoolId,
    action,
    resource,
    recordId,
    time: Date.now(),
  });
}
