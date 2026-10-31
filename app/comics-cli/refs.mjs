import { CliError } from "./errors.mjs";
import { gitResult, runGit } from "./git.mjs";

const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

function rejectUnsafe(ref) {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 256 || !REF_PATTERN.test(ref) || ref.includes("..") || ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/")) {
    throw new CliError(`invalid ref '${ref}'`);
  }
}

export async function resolveRef(primary, ref, execFile) {
  rejectUnsafe(ref);
  const listed = await runGit(execFile, primary, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes"]);
  const names = listed.split("\n").map((line) => line.trim()).filter(Boolean);
  const matches = names.filter((name) => name === ref || name === `refs/heads/${ref}` || name === `refs/tags/${ref}` || name === `refs/remotes/${ref}`);
  if (matches.length > 1) throw new CliError(`ambiguous ref '${ref}'`);
  if (matches.length === 1) {
    const sha = (await runGit(execFile, primary, ["rev-parse", "--verify", "--end-of-options", `${matches[0]}^{commit}`])).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new CliError(`unknown ref '${ref}'`);
    return { requested: ref, sha, source: matches[0] };
  }
  if (/^[0-9a-f]{4,40}$/i.test(ref)) {
    const result = await gitResult(execFile, primary, ["rev-parse", `--disambiguate=${ref.toLowerCase()}`]);
    const ids = String(result?.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const commits = [];
    for (const id of ids) {
      const typed = await gitResult(execFile, primary, ["cat-file", "-t", id]);
      if (typed?.code !== 0 || typed.stdout.trim() !== "commit") continue;
      const full = (await runGit(execFile, primary, ["rev-parse", "--verify", "--end-of-options", `${id}^{commit}`])).trim();
      if (/^[0-9a-f]{40}$/.test(full)) commits.push(full);
    }
    const unique = [...new Set(commits)];
    if (unique.length > 1) throw new CliError(`ambiguous ref '${ref}'`);
    if (unique.length === 1) return { requested: ref, sha: unique[0], source: "commit" };
    throw new CliError(`unknown ref '${ref}'`);
  }
  if (ref === "HEAD") {
    const sha = (await runGit(execFile, primary, ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"])).trim();
    return { requested: ref, sha, source: "HEAD" };
  }
  throw new CliError(`unknown ref '${ref}'`);
}
