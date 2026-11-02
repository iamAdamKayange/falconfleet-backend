import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
test("API guards writes, validates data and persists scoped records", async (t) => {
  const store = createStore();
  const server = createApp(store, { apiKey: "test-secret" }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer test-secret",
  };
  assert.equal((await fetch(`${base}/v1/records/fuel`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/v1/records/fuel`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Diesel", detail: "BUS-03", amount: -10 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/v1/records/unknown`, { headers })).status,
    404,
  );
  const created = await fetch(`${base}/v1/records/fuel`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Diesel refill",
      detail: "BUS-03",
      amount: 100000,
      status: "Pending",
    }),
  });
  assert.equal(created.status, 201);
  const { data } = await (
    await fetch(`${base}/v1/records/fuel`, { headers })
  ).json();
  assert.equal(data.length, 1);
  assert.equal(data[0].amount, 100000);
  const incident = await (
    await fetch(`${base}/v1/records/alerts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Boundary review",
        detail: "BUS-09",
        status: "Open",
      }),
    })
  ).json();
  const ack = await (
    await fetch(`${base}/v1/incidents/${incident.data.id}/acknowledge`, {
      method: "POST",
      headers,
    })
  ).json();
  assert.equal(ack.data.status, "Acknowledged");
});
