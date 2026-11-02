import { StatusDecoder } from "./osc.js";
import { Reporter } from "./reporter.js";
import { createSessionRelay } from "./session-relay.js";
import { sessionExists, SessionTracker } from "./session.js";
import { resumeArgv } from "./commands.js";

export function resolveFx(explicit, env = process.env, which = Bun.which) {
  if (explicit || env.HERDR_FX_BIN) {
    const path = which(explicit || env.HERDR_FX_BIN);
    if (!path) throw new Error("Configured fx executable was not found (HERDR_FX_BIN/--fx-bin)");
    return path;
  }
  // Prefer the standard command; support installations named vercel-fx too.
  const path = which("fx") ?? which("vercel-fx");
  if (!path) throw new Error("fx not found; put fx/vercel-fx on PATH or set HERDR_FX_BIN");
  return path;
}

export function createShutdownHandler(child, timeout = 1500) {
  let timer;
  let stopping = false;
  const kill = (signal) => { if (child.exitCode === null) child.kill(signal); };
  return {
    signal(signal) {
      if (stopping) { kill("SIGKILL"); return; }
      stopping = true;
      kill(signal);
      timer = setTimeout(() => kill("SIGKILL"), timeout);
      timer.unref?.();
    },
    dispose() { clearTimeout(timer); },
  };
}

export async function runFx({ fxBin, args = [], env = process.env, cwd = process.cwd() }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive fx needs a terminal; use Herdr's pane entrypoint");
  const debug = (error) => {
    if (env.HERDR_FX_DEBUG === "1") process.stderr.write(`[herdr-fx] ${error.message}\n`);
  };
  const enabled = Boolean(env.HERDR_SOCKET_PATH && env.HERDR_PANE_ID);
  let reporter;
  let tracker;
  let relay;
  let terminal;
  let child;
  let poll;
  let sawOsc = false;
  let shutdown;
  const signalHandlers = new Map();
  const wasRaw = Boolean(process.stdin.isRaw);
  const onInput = (data) => terminal?.write(data);
  const onResize = () => {
    terminal?.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    // Bun.Terminal.resize updates winsize but does not reliably signal the
    // child on macOS. Explicit delivery also refreshes Bun/Node TTY dimensions.
    if (child && child.exitCode === null) child.kill("SIGWINCH");
  };
  const decoder = new StatusDecoder((status) => {
    sawOsc = true;
    reporter?.status(status);
    if (status.state === "idle" || status.state === "done" || status.state === "error") void tracker?.check();
  });

  try {
    if (enabled) {
      reporter = new Reporter({ paneId: env.HERDR_PANE_ID, socketPath: env.HERDR_SOCKET_PATH, onError: debug });
      tracker = new SessionTracker({
        exists: (id) => sessionExists(fxBin, id, cwd),
        onSaved: (id) => reporter.session(id, resumeArgv(fxBin, id)),
        onChanged: () => reporter.invalidateSession(),
        onError: debug,
      });
      relay = await createSessionRelay({
        paneId: env.HERDR_PANE_ID,
        onSession: (id) => tracker.select(id),
        onFallbackStatus: (status) => { if (!sawOsc) reporter.status(status); },
      });
      reporter.status({ state: "idle" });
      poll = setInterval(() => void tracker.check(), 2000);
      poll.unref();
    }

    terminal = new Bun.Terminal({
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal, data) {
        // Keep terminal output byte-for-byte intact, including OSC for hosts
        // which understand it themselves. Decode only a separate observation.
        decoder.write(data);
        process.stdout.write(data);
      },
    });
    child = Bun.spawn([fxBin, ...args], {
      cwd,
      env: {
        ...env,
        ...(relay ? { HERDR_SOCKET_PATH: relay.socketPath, FX_HERDR: "1" } : {}),
      },
      terminal,
    });
    shutdown = createShutdownHandler(child);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onInput);
    process.stdout.on("resize", onResize);
    for (const signal of ["SIGTERM", "SIGHUP", "SIGINT", "SIGQUIT"]) {
      const handler = () => shutdown.signal(signal);
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    // Ctrl-C from the user goes through the PTY, where fx can handle it.
    const code = await child.exited;
    return typeof code === "number" && code >= 0 ? code : 1;
  } finally {
    clearInterval(poll);
    tracker?.close();
    process.stdin.off("data", onInput);
    process.stdout.off("resize", onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    if (child && child.exitCode === null) {
      shutdown.signal("SIGTERM");
      await child.exited;
    }
    shutdown?.dispose();
    terminal?.close();
    await relay?.close();
    await reporter?.close();
  }
}
