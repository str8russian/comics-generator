import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECOVERY_RUN_ID, START_HEAD, recoverTimedOutCell } from "./lib/recover.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const result = await recoverTimedOutCell({
  runDir: join(root, "results", RECOVERY_RUN_ID),
  allowLive: true,
  enforceAcceptedHashes: true,
  git: readGitState(),
});
console.log(JSON.stringify({
  ok: result.ok,
  providerCalls: result.providerCalls,
  reason: result.reason || null,
  status: result.status || null,
  failureKind: result.failureKind || null,
  providerInvocations: result.providerInvocations ?? null,
  failedInvocations: result.failedInvocations ?? null,
  succeeded: result.succeeded ?? null,
  failed: result.failed ?? null,
}));
process.exit(result.exitCode);

function readGitState() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  const headText = (head.stdout || "").trim();
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", START_HEAD, headText]);
  return {
    head: headText,
    status: status.status === 0 ? (status.stdout || "") : "git-status-failed",
    ancestor: ancestor.status === 0,
  };
}
