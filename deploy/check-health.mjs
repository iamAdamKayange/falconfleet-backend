import { pathToFileURL } from "node:url";

export async function checkHealth(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.status === "ok" && health?.storage === "postgres";
  } catch {
    // Refused connections and incomplete responses are expected during startup.
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) process.exit(1);
  process.exit(await checkHealth(`http://127.0.0.1:${port}/v2/health`) ? 0 : 1);
}
