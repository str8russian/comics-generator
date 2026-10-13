import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export function resolveBuildInfo({ env = {}, gitSha = null, fileInfo = null } = {}) {
  const fromEnv = typeof env.STORYBOARD_BUILD_ID === "string" ? env.STORYBOARD_BUILD_ID.trim() : "";
  if (fromEnv) {
    return {
      id: fromEnv,
      source: "env",
      builtAt: typeof env.STORYBOARD_BUILD_TIME === "string" ? env.STORYBOARD_BUILD_TIME : null,
    };
  }
  if (typeof gitSha === "string" && gitSha) return { id: gitSha, source: "git", builtAt: null };
  if (fileInfo && typeof fileInfo.id === "string" && fileInfo.id) {
    return {
      id: fileInfo.id,
      source: fileInfo.source || "source",
      builtAt: fileInfo.builtAt || null,
    };
  }
  return { id: "dev", source: "fallback", builtAt: null };
}

export function loadBuildInfo({
  env = process.env,
  cwd = repoRoot,
  gitSha = readGitSha(cwd),
  fileInfo = readBuildFile(cwd),
} = {}) {
  return resolveBuildInfo({ env, gitSha, fileInfo });
}

function readGitSha(cwd) {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function readBuildFile(cwd) {
  const file = path.join(cwd, "build-info.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}
