import express from "express";
import cors from "cors";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { collections, recordSchema } from "./validation.js";
export function createApp(
  store,
  { apiKey, origin = "http://localhost:3000" } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/v1/health", async (_req, res) => {
    try {
      await store.check();
      res.json({ status: "ok", storage: store.kind, stage: "development" });
    } catch {
      res
        .status(503)
        .json({ error: "Database unavailable or migrations pending" });
    }
  });
  app.use("/v1", (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (
      !apiKey ||
      Buffer.byteLength(token) !== Buffer.byteLength(apiKey) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))
    )
      return res.status(401).json({ error: "Authentication required" });
    next();
  });
  app.param("collection", (req, res, next, value) => {
    if (!collections.includes(value))
      return res.status(404).json({ error: "Unknown collection" });
    next();
  });
  app.get("/v1/records/:collection", async (req, res) =>
    res.json({ data: await store.list(req.params.collection) }),
  );
  app.post("/v1/records/:collection", async (req, res) => {
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error: "Invalid record",
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
    res
      .status(201)
      .json({ data: await store.create(req.params.collection, parsed.data) });
  });
  app.post("/v1/incidents/:id/acknowledge", async (req, res) => {
    const row = await store.acknowledge(req.params.id);
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json({ data: row });
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "Request too large" });
    console.error("Request failed:", err.code || err.name);
    res.status(500).json({ error: "Request failed. Please retry." });
  });
  return app;
}
