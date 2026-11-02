import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { socketServer } from "./helpers.js";
import { SOURCE } from "../src/reporter.js";
import { createShutdownHandler } from "../src/runtime.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-fx.js", import.meta.url));
const launcher = fileURLToPath(new URL("../bin/herdr-fx.js", import.meta.url));

async function launch(argv, env, cwd = process.cwd()) {
  const output = [];
  let resize;
  let sentInput = false;
  const terminal = new Bun.Terminal({ cols: 80, rows: 24, data(_, data) {
    output.push(Buffer.from(data));
    if (!sentInput && Buffer.concat(output).includes(Buffer.from("INPUT_READY"))) {
      sentInput = true;
      terminal.write(Buffer.from([0x03, 0x61, 0x62, 0x0d]));
    }
    if (!resize && Buffer.concat(output).includes(Buffer.from("FAKE_FX_ARGS="))) {
      resize = setTimeout(() => { terminal.resize(100, 40); child.kill("SIGWINCH"); }, 30);
    }
  } });
  const child = Bun.spawn(argv, { cwd, env: { ...process.env, ...env }, terminal });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { return { code: await child.exited, output: Buffer.concat(output).toString("utf8") }; }
  finally { clearTimeout(resize); clearTimeout(deadline); terminal.close(); }
}

test("PTY launch reports lifecycle, saves exact restore argv, restores through adapter, and cleans up", async () => {
  await chmod(fixture, 0o755);
  const calls = [];
  const server = await socketServer((client, message) => {
    calls.push(message);
    client.end(JSON.stringify({ id: message.id, result: {} }) + "\n");
  });
  const saved = join(server.directory, "saved");
  const env = { HERDR_SOCKET_PATH: server.socketPath, HERDR_PANE_ID: "w:p", HERDR_FX_TEST_SAVED: saved, HERDR_FX_TEST_INPUT: "1" };
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const manifest = Bun.TOML.parse(await Bun.file(join(root, "herdr-plugin.toml")).text());
    const result = await launch([...manifest.panes[0].command, "hello ; $(not-a-command)"], {
      ...env, HERDR_PLUGIN_ROOT: root, HERDR_FX_BIN: fixture,
    }, server.directory);
    assert.equal(result.code, 7, result.output);
    assert.ok(result.output.includes('FAKE_FX_ARGS=["hello ; $(not-a-command)"]'), result.output);
    assert.ok(result.output.includes("RESIZED=100x40"), result.output);
    assert.ok(result.output.includes("INPUT_HEX=0361620d"), result.output);
    const reports = calls.filter((call) => call.method === "pane.report_agent");
    const states = reports.map((call) => call.params.state);
    assert.ok(states.includes("working"));
    assert.ok(states.includes("blocked"));
    const blocked = reports.findIndex((call) => call.params.message === "Run tests?");
    assert.ok(blocked >= 0);
    assert.ok(reports.slice(blocked + 1).some((call) => call.params.state === "working"));
    assert.equal(reports.at(-1).params.state, "idle");
    assert.ok(!reports.some((call) => call.params.message === "stale-native-state"));
    const restore = reports.find((call) => call.params.resume_argv)?.params.resume_argv;
    assert.ok(restore, JSON.stringify(calls));
    assert.deepEqual(restore.slice(-2), ["--resume", "saved-root"]);
    assert.equal(calls.at(-1).method, "pane.clear_agent_authority");
    assert.ok(calls.every((call) => call.params.source === SOURCE));
    assert.ok(calls.every((call, i) => i === 0 || call.params.seq > calls[i - 1].params.seq));
    const restored = await launch([process.execPath, ...restore.slice(1)], env, server.directory);
    assert.equal(restored.code, 7, restored.output);
    assert.ok(restored.output.includes('"--resume","saved-root"'), restored.output);
  } finally { await server.close(); await rm(saved, { force: true }); }
}, 15000);

test("shutdown forwards the first signal and escalates a second signal or deadline", async () => {
  const signals = [];
  const child = { exitCode: null, kill: (signal) => signals.push(signal) };
  const shutdown = createShutdownHandler(child, 15);
  shutdown.signal("SIGTERM");
  shutdown.signal("SIGINT");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  shutdown.dispose();
  const timeout = createShutdownHandler(child, 10);
  timeout.signal("SIGHUP");
  await Bun.sleep(25);
  assert.deepEqual(signals.slice(-2), ["SIGHUP", "SIGKILL"]);
  timeout.dispose();
});

test("doctor and help need no terminal, server connection, or model call", async () => {
  for (const args of [["--help"], ["--doctor", "--fx-bin", fixture]]) {
    const child = Bun.spawn([process.execPath, launcher, ...args], { stdout: "pipe", stderr: "pipe" });
    assert.equal(await child.exited, 0, await new Response(child.stderr).text());
    assert.ok((await new Response(child.stdout).text()).length > 0);
  }
});
