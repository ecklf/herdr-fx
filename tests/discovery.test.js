import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolveFx } from "../src/runtime.js";

test("discovery prefers fx when both executable names are available", () => {
  const lookups = [];
  const which = (name) => { lookups.push(name); return `/bin/${name}`; };
  assert.equal(resolveFx(undefined, {}, which), "/bin/fx");
  assert.deepEqual(lookups, ["fx"]);
});

test("discovery falls back to vercel-fx only when fx is missing", () => {
  const lookups = [];
  const which = (name) => { lookups.push(name); return name === "vercel-fx" ? "/bin/vercel-fx" : null; };
  assert.equal(resolveFx(undefined, {}, which), "/bin/vercel-fx");
  assert.deepEqual(lookups, ["fx", "vercel-fx"]);
});

test("explicit binary overrides the environment and discovery", () => {
  const lookups = [];
  const which = (name) => { lookups.push(name); return name; };
  assert.equal(resolveFx("/custom/fx", { HERDR_FX_BIN: "/env/fx" }, which), "/custom/fx");
  assert.deepEqual(lookups, ["/custom/fx"]);
});

test("HERDR_FX_BIN overrides executable discovery", () => {
  assert.equal(resolveFx(undefined, { HERDR_FX_BIN: "/env/fx" }, (name) => name), "/env/fx");
});

test("missing configured executables fail instead of silently falling back", () => {
  assert.throws(() => resolveFx("/missing/fx", {}, () => null), /Configured fx executable was not found/);
  assert.throws(() => resolveFx(undefined, {}, () => null), /fx not found/);
});
