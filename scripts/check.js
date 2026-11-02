import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = Bun.TOML.parse(await Bun.file(resolve(root, "herdr-plugin.toml")).text());
const pkg = await Bun.file(resolve(root, "package.json")).json();
assert.equal(manifest.id, "herdr-fx");
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.min_herdr_version, "0.9.5");
assert.deepEqual(manifest.platforms, ["macos", "linux"]);
for (const group of [manifest.actions, manifest.panes]) {
  assert.equal(new Set(group.map((item) => item.id)).size, group.length);
  for (const item of group) {
    assert.ok(item.title);
    assert.ok(item.command.every((arg) => typeof arg === "string" && arg.length > 0));
    if (item.command[0] === "bun") {
      assert.ok(existsSync(resolve(root, item.command[1])));
    } else {
      assert.equal(item.command[0], "sh");
      assert.equal(item.command[1], "-c");
      assert.equal(item.command[2], 'exec bun "$HERDR_PLUGIN_ROOT/bin/herdr-fx.js" "$@"');
      assert.ok(existsSync(resolve(root, "bin/herdr-fx.js")));
    }
  }
}
const compiler = new Bun.Transpiler({ loader: "js", target: "bun" });
let count = 0;
for (const path of new Bun.Glob("{src,bin,scripts,tests}/**/*.js").scanSync({ cwd: root })) {
  compiler.transformSync(await Bun.file(resolve(root, path)).text());
  count++;
}
console.log(`Manifest/entrypoints valid; ${count} JavaScript files parsed`);
