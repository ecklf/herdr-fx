import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { Reporter, SOURCE, validateResumeArgv, validSessionId } from "../src/reporter.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function recorder(options = {}) {
  const calls = [];
  const reporter = new Reporter({ paneId: "w1:p1", socketPath: "unused", send: async (_, method, params) => calls.push({ method, params }), ...options });
  return { reporter, calls };
}

describe("Herdr reporter", () => {
  test("serializes lifecycle transitions, deduplicates, and scopes exit cleanup", async () => {
    const { reporter, calls } = recorder();
    reporter.status({ state: "working" });
    reporter.status({ state: "working" });
    reporter.status({ state: "blocked", kind: "permission" });
    reporter.status({ state: "working" });
    reporter.status({ state: "done" });
    await reporter.flush();
    assert.deepEqual(calls.map((c) => c.params.state), ["working", "blocked", "working", "idle"]);
    assert.ok(calls.every((c) => c.params.source === SOURCE && c.params.pane_id === "w1:p1"));
    await reporter.close();
    assert.equal(calls.at(-1).method, "pane.clear_agent_authority");
    assert.ok(calls.every((call, i) => i === 0 || call.params.seq > calls[i - 1].params.seq));
    reporter.status({ state: "working" });
    assert.equal(calls.length, 5);
  });

  test("attaches exact resume argv and clears it before switching sessions", async () => {
    const { reporter, calls } = recorder();
    reporter.status({ state: "idle" });
    reporter.session("saved-a", ["bun", "/plugin/launcher.js", "--resume", "saved-a"]);
    await reporter.flush();
    assert.equal(calls.at(-1).params.agent_session_id, "saved-a");
    reporter.invalidateSession();
    await reporter.flush();
    assert.equal(calls.at(-2).method, "pane.clear_agent_authority");
    assert.equal(calls.at(-1).params.resume_argv, undefined);
    await reporter.close();
  });

  test("retries failed delivery of latest state without reviving obsolete state", async () => {
    const calls = [];
    let fail = true;
    const { reporter } = recorder({ retryDelay: 5, send: async (_, method, params) => {
      calls.push({ method, params });
      if (fail) throw new Error("offline");
    } });
    reporter.status({ state: "working" });
    await reporter.flush();
    reporter.status({ state: "blocked", kind: "question" });
    await reporter.flush();
    fail = false;
    await delay(25);
    await reporter.flush();
    assert.equal(calls.at(-1).params.state, "blocked");
    assert.equal(calls.filter((c) => c.params.state === "working").length, 1);
    await reporter.close();
    const count = calls.length;
    await delay(15);
    assert.equal(calls.length, count);
  });

  test("a failed identity reset cannot publish the new session until reset succeeds", async () => {
    let resetFails = true;
    const calls = [];
    const { reporter } = recorder({ retryDelay: 5, send: async (_, method, params) => {
      calls.push({ method, params });
      if (method === "pane.clear_agent_authority" && resetFails) throw new Error("offline");
    } });
    reporter.session("old", ["fx", "-r", "old"]);
    await reporter.flush();
    reporter.invalidateSession();
    reporter.session("new", ["fx", "-r", "new"]);
    await reporter.flush();
    assert.ok(!calls.some((c) => c.params.agent_session_id === "new"));
    resetFails = false;
    await delay(25);
    await reporter.flush();
    assert.equal(calls.at(-1).params.agent_session_id, "new");
    await reporter.close();
  });

  test("does not rewrite pane labels or send duplicate notification requests", async () => {
    const { reporter, calls } = recorder();
    reporter.status({ state: "done" });
    await reporter.flush();
    await reporter.close();
    assert.ok(calls.every((c) => ["pane.report_agent", "pane.clear_agent_authority"].includes(c.method)));
  });

  test("shutdown drains queued completion and restore reports before release", async () => {
    const calls = [];
    const { reporter } = recorder({ send: async (_, method, params) => {
      await delay(10);
      calls.push({ method, params });
    } });
    reporter.status({ state: "working" });
    reporter.session("saved", ["fx", "--resume", "saved"]);
    reporter.status({ state: "done" });
    await Promise.all([reporter.close(), reporter.close()]);
    assert.deepEqual(calls.map((c) => c.params.state), ["working", "working", "idle", undefined]);
    assert.equal(calls.at(-2).params.agent_session_id, "saved");
    assert.equal(calls.at(-1).method, "pane.clear_agent_authority");
  });

  test("validates Herdr's resume argv constraints", () => {
    for (const argv of [[], ["/bin/fx"], ["fx", "a'b"], ["fx", "\n"], ["fx", "x".repeat(8192)], ["-fx"]]) {
      assert.throws(() => validateResumeArgv(argv));
    }
    assert.deepEqual(validateResumeArgv(["bun", "/path with spaces/app.js", "-r", "id"]), ["bun", "/path with spaces/app.js", "-r", "id"]);
    assert.ok(validSessionId("session-123"));
    assert.ok(!validSessionId("--model"));
  });
});
