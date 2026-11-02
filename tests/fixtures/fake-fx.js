#!/usr/bin/env bun
// Deterministic fx protocol fixture: no models, credentials, or real sessions.
import { existsSync } from "node:fs";
import { request } from "../../src/transport.js";

const args = process.argv.slice(2);
if (args[0] === "session") {
  process.exit(args[1] === "--id" && args[2] === "saved-root" && existsSync(process.env.HERDR_FX_TEST_SAVED) ? 0 : 1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("fx did not receive a PTY");
const params = { pane_id: process.env.HERDR_PANE_ID, source: "custom:fx", agent: "fx" };
const native = (method, extra) => request(process.env.HERDR_SOCKET_PATH, method, { ...params, ...extra });
const osc = (state) => process.stdout.write(`\x1b]7501;${state}:app=fx\x1b\\`);
process.stdout.write(`FAKE_FX_ARGS=${JSON.stringify(args)}\n`);
process.stdout.on("resize", () => process.stdout.write(`RESIZED=${process.stdout.columns}x${process.stdout.rows}\n`));
if (process.env.HERDR_FX_TEST_INPUT === "1") {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const input = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No PTY input received")), 1000);
    process.stdin.once("data", (data) => { clearTimeout(timer); resolve(data); });
  });
  process.stdout.write("INPUT_READY\n");
  process.stdout.write(`INPUT_HEX=${Buffer.from(await input).toString("hex")}\n`);
}
await native("pane.report_agent_session", { agent_session_id: "saved-root" });
await native("pane.rename", { label: "fx" });
osc("state=working");
await Bun.sleep(80);
osc("state=blocked:kind=permission:msg=UnVuIHRlc3RzPw==");
await Bun.sleep(80);
osc("state=working");
await Bun.write(process.env.HERDR_FX_TEST_SAVED, "saved");
await Bun.sleep(80);
osc("state=done");
await native("pane.report_agent", { state: "blocked", custom_status: "stale-native-state" });
await Bun.sleep(300);
osc("state=clear");
process.exit(7);
