import { createStore } from "./store.js";
import { createApp } from "./app.js";
if (
  !process.env.API_KEY ||
  process.env.API_KEY.startsWith("replace-") ||
  process.env.API_KEY.length < 32
)
  throw Error(
    "Set a random API_KEY of at least 32 characters in backend/.env before starting.",
  );
const store = createStore(
  process.env.DATABASE_URL,
  process.env.SCHOOL_ID || "mbeya-pilot",
);
const app = createApp(store, {
  apiKey: process.env.API_KEY,
  origin: process.env.CORS_ORIGIN,
});
const server = app.listen(Number(process.env.PORT) || 4000, () =>
  console.log(
    `FalconFleet development API: http://localhost:${process.env.PORT || 4000} (${store.kind} storage)`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  });
