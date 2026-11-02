import { fileURLToPath } from "node:url";
import { validateResumeArgv } from "./reporter.js";

export const launcherPath = fileURLToPath(new URL("../bin/herdr-fx.js", import.meta.url));

export function parseLaunchArgs(args) {
  let fxBin;
  const forwarded = [];
  let help = false;
  let doctor = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") { forwarded.push(...args.slice(index + 1)); break; }
    if (arg === "--fx-bin") {
      fxBin = args[++index];
      if (!fxBin || fxBin.startsWith("--")) throw new Error("--fx-bin requires one executable path");
    } else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--doctor") doctor = true;
    else forwarded.push(arg);
  }
  return { fxBin, forwarded, help, doctor };
}

export function resumeArgv(fxBin, sessionId) {
  // Restore through this adapter, not bare fx, so reporting survives restart.
  // Do not replay prompts or permission flags from the initial invocation.
  return validateResumeArgv(["bun", launcherPath, "--fx-bin", fxBin, "--resume", sessionId]);
}

export function openArgs(env, resume = false) {
  let context;
  try { context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}"); }
  catch { throw new Error("Invalid HERDR_PLUGIN_CONTEXT_JSON"); }
  const cwd = context.focused_pane_cwd ?? context.workspace_cwd;
  if (typeof cwd !== "string" || !cwd.startsWith("/") || /[\x00-\x1f]/.test(cwd)) {
    throw new Error("Herdr did not provide an absolute project cwd; open the pane with --cwd explicitly");
  }
  const args = ["plugin", "pane", "open", "--plugin", "herdr-fx", "--entrypoint", resume ? "resume" : "session",
    "--placement", "split", "--cwd", cwd, "--focus"];
  if (env.HERDR_WORKSPACE_ID) args.push("--workspace", env.HERDR_WORKSPACE_ID);
  if (env.HERDR_PANE_ID) args.push("--target-pane", env.HERDR_PANE_ID, "--direction", "right");
  return args;
}
