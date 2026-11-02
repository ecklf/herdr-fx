#!/usr/bin/env bun
import { parseLaunchArgs } from "../src/commands.js";
import { resolveFx, runFx } from "../src/runtime.js";

const help = `Usage: bun bin/herdr-fx.js [--fx-bin PATH] [fx arguments...]

  --resume [ID]    Open fx's picker, or restore an exact saved session
  --doctor         Check runtime, fx executable, and Herdr environment (no model calls)
  --help           Show this help (use -- --help for fx's own help)

Environment: HERDR_FX_BIN overrides fx discovery; HERDR_FX_DEBUG=1 logs delivery errors.
Requires Bun >=1.3.5 on macOS/Linux and interactive fx with OSC 7501 support.
`;

try {
  const options = parseLaunchArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help);
  } else {
    if (!["darwin", "linux"].includes(process.platform) || typeof Bun.Terminal !== "function") {
      throw new Error("This launcher requires Bun >=1.3.5 with PTY support on macOS/Linux");
    }
    const fxBin = resolveFx(options.fxBin);
    if (options.doctor) {
      process.stdout.write(`${JSON.stringify({
        bun: Bun.version,
        fx: fxBin,
        herdr: Boolean(process.env.HERDR_SOCKET_PATH && process.env.HERDR_PANE_ID),
        tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      }, null, 2)}\n`);
    } else {
      process.exitCode = await runFx({ fxBin, args: options.forwarded });
    }
  }
} catch (error) {
  process.stderr.write(`herdr-fx: ${error.message}\n`);
  process.exitCode = 1;
}
