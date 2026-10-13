import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildInfo } from "../build-info.mjs";

test("build identity prefers an injected id, then git, then the image fingerprint, then dev", () => {
  assert.deepEqual(resolveBuildInfo({
    env: { STORYBOARD_BUILD_ID: "explicit", STORYBOARD_BUILD_TIME: "2026-10-14T00:00:00Z" },
    gitSha: "abcdef123456",
  }), { id: "explicit", source: "env", builtAt: "2026-10-14T00:00:00Z" });
  assert.deepEqual(resolveBuildInfo({ gitSha: "abcdef123456" }), {
    id: "abcdef123456",
    source: "git",
    builtAt: null,
  });
  assert.deepEqual(resolveBuildInfo({
    fileInfo: { id: "sourcehash12", source: "docker-source", builtAt: "2026-10-14T01:02:03Z" },
  }), { id: "sourcehash12", source: "docker-source", builtAt: "2026-10-14T01:02:03Z" });
  assert.deepEqual(resolveBuildInfo({}), { id: "dev", source: "fallback", builtAt: null });
});
