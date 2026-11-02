import express from "express";
import helmet from "helmet";
import cors from "cors";
import { randomBytes } from "node:crypto";
import { createIdentityStore } from "./identity-store.js";
import { createIdentityRouter } from "./identity-api.js";
import { seedDemo } from "./seed.js";
import { roles } from "./access.js";
const production = process.env.NODE_ENV === "production";
const demo =
  process.env.DEMO_MODE === "true" && !production && !process.env.DATABASE_URL;
if (production && !process.env.DATABASE_URL)
  throw Error("Production requires Neon DATABASE_URL");
if (production && !process.env.APP_ORIGIN?.startsWith("https://"))
  throw Error("Set HTTPS APP_ORIGIN before production startup");
const store = createIdentityStore(process.env.DATABASE_URL);
await store.init();
const app = express();
app.disable("x-powered-by");
app.use(helmet());
const origin = process.env.APP_ORIGIN || "http://localhost:3100";
app.use(cors({ origin, credentials: true }));
if (demo) {
  const password = randomBytes(24).toString("base64url");
  await seedDemo(store, password);
  app.get("/v2/auth/demo", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      accounts: Object.entries(roles).map(([role, r]) => ({
        role,
        name: r.label,
        email: `${role}@demo.falconfleet.test`,
        password,
      })),
    });
  });
}
app.use("/v2", createIdentityRouter(store, { origin, secure: production }));
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
const server = app.listen(Number(process.env.PORT) || 4000, "127.0.0.1", () =>
  console.log(
    `FalconFleet secure API on 127.0.0.1:${process.env.PORT || 4000}; ${store.kind}; demo=${demo}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await store.close();
      process.exit(0);
    }),
  );
