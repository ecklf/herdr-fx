import { test } from "bun:test";
import assert from "node:assert/strict";
import { SessionTracker, sessionExists } from "../src/session.js";
import { parseLaunchArgs, openArgs, resumeArgv } from "../src/commands.js";
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("only registers a reported exact ID after it is saved", async () => {
  let saved = false;
  const restored = [];
  const tracker = new SessionTracker({ exists: async (id) => { assert.equal(id, "exact"); return saved; }, onSaved: (id) => restored.push(id) });
  tracker.select("exact");
  await tick();
  assert.deepEqual(restored, []);
  saved = true;
  await tracker.check();
  await tracker.check();
  assert.deepEqual(restored, ["exact"]);
  tracker.close();
});

test("does not apply an old asynchronous lookup after a session switch or close", async () => {
  let resolve;
  const saved = [];
  let changed = 0;
  const tracker = new SessionTracker({ exists: () => new Promise((done) => { resolve = done; }), onSaved: (id) => saved.push(id), onChanged: () => changed++ });
  tracker.select("a");
  tracker.select("b");
  resolve(true);
  await tick();
  assert.deepEqual(saved, []);
  assert.equal(changed, 1);
  tracker.close();
  resolve(true);
  await tick();
  assert.deepEqual(saved, []);
});

test("session inspection handles missing executables and bounds hung processes", async () => {
  assert.equal(await sessionExists("/nonexistent/herdr-fx", "id", process.cwd()), false);
  const fixture = fileURLToPath(new URL("./fixtures/hanging-fx.js", import.meta.url));
  await chmod(fixture, 0o755);
  const start = Date.now();
  assert.equal(await sessionExists(fixture, "id", process.cwd(), 50), false);
  assert.ok(Date.now() - start < 1000);
});

test("launch options preserve prompt argv without shell evaluation", () => {
  assert.deepEqual(parseLaunchArgs(["--fx-bin", "/path with spaces/fx", "--model", "m", "$(touch nope)"]), {
    fxBin: "/path with spaces/fx", forwarded: ["--model", "m", "$(touch nope)"], help: false, doctor: false,
  });
  assert.throws(() => parseLaunchArgs(["--fx-bin"]));
  assert.deepEqual(parseLaunchArgs(["--", "--help"]).forwarded, ["--help"]);
  const argv = resumeArgv("/bin/fx", "exact-id");
  assert.deepEqual(argv.slice(-4), ["--fx-bin", "/bin/fx", "--resume", "exact-id"]);
  assert.ok(!argv.includes("--full-access"));
});

test("open action uses project context and never defaults to the plugin directory", () => {
  const args = openArgs({ HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: "/repo with spaces", workspace_cwd: "/other" }), HERDR_WORKSPACE_ID: "w1", HERDR_PANE_ID: "p1" }, true);
  assert.equal(args[args.indexOf("--cwd") + 1], "/repo with spaces");
  assert.equal(args[args.indexOf("--entrypoint") + 1], "resume");
  assert.throws(() => openArgs({}));
  assert.throws(() => openArgs({ HERDR_PLUGIN_CONTEXT_JSON: "not json" }));
});
