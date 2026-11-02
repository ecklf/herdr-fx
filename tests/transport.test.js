import { test } from "bun:test";
import assert from "node:assert/strict";
import { request } from "../src/transport.js";
import { socketServer } from "./helpers.js";
import { createSessionRelay } from "../src/session-relay.js";
import { stat } from "node:fs/promises";
import net from "node:net";

test("socket transport waits for a complete response and checks the request ID", async () => {
  const server = await socketServer((client, message) => {
    const response = JSON.stringify({ id: message.id, result: { ok: true } });
    client.write(response.slice(0, 7));
    setTimeout(() => client.end(response.slice(7) + "\n"), 5);
  });
  try { assert.deepEqual(await request(server.socketPath, "pane.report_agent", {}), { ok: true }); }
  finally { await server.close(); }
});

test("socket transport rejects error responses, wrong IDs, disconnects, and hung peers", async () => {
  for (const mode of ["error", "id", "disconnect", "hang"]) {
    const server = await socketServer((client, message) => {
      if (mode === "disconnect") client.end();
      else if (mode !== "hang") client.end(JSON.stringify({ id: mode === "id" ? "wrong" : message.id,
        ...(mode === "error" ? { error: { code: "invalid", message: "bad" } } : { result: {} }) }) + "\n");
    });
    try { await assert.rejects(request(server.socketPath, "test", {}, { timeout: 25 })); }
    finally { await server.close(); }
  }
});

test("private relay captures only fx identity and consumes native rename/cleanup requests", async () => {
  const sessions = [];
  const statuses = [];
  const relay = await createSessionRelay({ paneId: "w:p", onSession: (id) => sessions.push(id), onFallbackStatus: (status) => statuses.push(status) });
  try {
    assert.equal((await stat(relay.socketPath)).mode & 0o777, 0o600);
    await request(relay.socketPath, "pane.report_agent_session", { pane_id: "w:p", source: "custom:fx", agent: "fx", agent_session_id: "root" });
    await request(relay.socketPath, "pane.report_agent", { pane_id: "w:p", source: "custom:fx", agent: "fx", state: "working" });
    await request(relay.socketPath, "pane.rename", { pane_id: "w:p", label: "fx" });
    await request(relay.socketPath, "agent.rename", { target: "w:p", name: "fx" });
    await request(relay.socketPath, "pane.clear_agent_authority", { pane_id: "w:p", source: "custom:fx" });
    for (const params of [{ pane_id: "other", source: "custom:fx", agent: "fx", agent_session_id: "bad" },
      { pane_id: "w:p", source: "other", agent: "fx", agent_session_id: "bad" }]) {
      await assert.rejects(request(relay.socketPath, "pane.report_agent_session", params));
    }
    assert.deepEqual(sessions, ["root"]);
    assert.equal(statuses[0].state, "working");
  } finally { await relay.close(); }
  await assert.rejects(stat(relay.socketPath));
});

test("relay handles a connection once even when more bytes arrive after its first line", async () => {
  const sessions = [];
  const relay = await createSessionRelay({ paneId: "p", onSession: (id) => sessions.push(id) });
  const client = net.createConnection(relay.socketPath);
  client.on("error", () => {});
  try {
    await new Promise((resolve) => client.once("connect", resolve));
    const closed = new Promise((resolve) => client.once("close", resolve));
    client.write(JSON.stringify({ id: "first", method: "pane.report_agent_session", params: {
      pane_id: "p", source: "custom:fx", agent: "fx", agent_session_id: "root",
    } }) + "\n");
    client.on("data", () => { client.write("trailing bytes"); client.end(); });
    await closed;
    assert.deepEqual(sessions, ["root"]);
  } finally { client.destroy(); await relay.close(); }
});
