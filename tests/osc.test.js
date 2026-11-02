import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { StatusDecoder, parseStatus, toHerdrState } from "../src/osc.js";

const osc = (payload, end = "\x1b\\") => Buffer.from(`\x1b]7501;${payload}${end}`);

describe("OSC status adapter", () => {
  test("decodes every possible chunk boundary without reading ordinary text", () => {
    const input = Buffer.concat([Buffer.from("working idle permission required"), osc("state=working:app=fx"),
      osc("state=blocked:kind=question:app=fx:msg=VGVzdD8="), osc("state=done:app=fx", "\x07")]);
    for (let split = 0; split <= input.length; split++) {
      const states = [];
      const decoder = new StatusDecoder((status) => states.push(status));
      decoder.write(input.subarray(0, split));
      decoder.write(input.subarray(split));
      assert.deepEqual(states, [{ state: "working" }, { state: "blocked", kind: "question", message: "Test?" }, { state: "done" }]);
    }
  });

  test("ignores foreign apps, child records, clear, duplicate fields, and invalid base64", () => {
    for (const payload of ["state=working:app=other", "state=working:app=fx:id=child", "state=clear",
      "state=working:app=fx:app=fx", "state=blocked:app=fx:msg=%%%", "state=nope:app=fx"]) {
      assert.equal(parseStatus(payload), undefined);
    }
  });

  test("sanitizes messages and caps decoded size", () => {
    const msg = Buffer.from("question\n\x1b\x07" + "é".repeat(400)).toString("base64");
    const status = parseStatus(`state=blocked:app=fx:msg=${msg}`);
    assert.ok([...status.message].length <= 256);
    assert.ok(!/[\p{Cc}\p{Cf}]/u.test(status.message));
  });

  test("recovers from oversized, malformed, and unrelated OSC sequences", () => {
    const states = [];
    const decoder = new StatusDecoder((status) => states.push(status));
    decoder.write(Buffer.from(`\x1b]2;title\x07\x1b]7501;${"x".repeat(10000)}\x1b\\`));
    decoder.write(Buffer.from("\x1b]7501;bad\x1b]7501;state=idle:app=fx\x1b\\"));
    assert.deepEqual(states, [{ state: "idle" }]);
  });

  test("maps protocol outcomes to legal Herdr states", () => {
    assert.deepEqual(toHerdrState({ state: "done" }), { state: "idle" });
    assert.deepEqual(toHerdrState({ state: "error" }), { state: "blocked", message: "fx turn failed" });
    assert.deepEqual(toHerdrState({ state: "blocked", kind: "permission" }), { state: "blocked", message: "Permission required" });
    assert.deepEqual(toHerdrState({ state: "working" }), { state: "working" });
  });
});
