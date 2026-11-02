import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkHealth } from "../deploy/check-health.mjs";

test("startup health checks tolerate unavailable or partial responses and require PostgreSQL", async (t) => {
  let status = 200;
  let body = "";
  const server = createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v2/health`;
  for (const payload of ["", "{", "<html>Starting</html>", "null", '{"status":"ok","storage":"memory"}']) {
    body = payload;
    assert.equal(await checkHealth(url), false);
  }
  body = '{"status":"ok","storage":"postgres"}';
  status = 503;
  assert.equal(await checkHealth(url), false);
  status = 200;
  assert.equal(await checkHealth(url), true);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await checkHealth(url), false);
});
