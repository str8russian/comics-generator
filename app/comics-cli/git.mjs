import { CliError } from "./errors.mjs";
import { redact } from "./redact.mjs";

const BANNED = new Set(["fetch", "pull", "push", "rebase", "merge", "reset", "clean", "stash", "remote"]);

function assertAllowed(args) {
  if (!Array.isArray(args) || args.length === 0 || BANNED.has(args[0])) {
    throw new CliError(`refusing git ${args?.[0] ?? "command"}`);
  }
  if (args[0] === "checkout" && args[1] !== "--detach") throw new CliError("refusing git checkout");
}

export async function gitResult(execFile, cwd, args) {
  assertAllowed(args);
  try {
    return await execFile("git", ["-C", cwd, ...args], { cwd });
  } catch {
    return { code: 1, stdout: "", stderr: `git ${args[0]} failed` };
  }
}

export async function runGit(execFile, cwd, args, secrets = []) {
  const result = await gitResult(execFile, cwd, args);
  if (!result || result.code !== 0) {
    const detail = redact(String(result?.stderr || result?.stdout || "").trim().split("\n")[0] ?? "", secrets);
    throw new CliError(detail ? `git ${args[0]} failed: ${detail}` : `git ${args[0]} failed`);
  }
  return result.stdout;
}
