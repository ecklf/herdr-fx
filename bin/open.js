#!/usr/bin/env bun
import { openArgs } from "../src/commands.js";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--resume")) throw new Error("Only --resume is supported by this action");
  const herdr = process.env.HERDR_BIN_PATH || "herdr";
  const child = Bun.spawn([herdr, ...openArgs(process.env, args.includes("--resume"))], {
    stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  process.exitCode = await child.exited;
} catch (error) {
  process.stderr.write(`herdr-fx: ${error.message}\n`);
  process.exitCode = 1;
}
