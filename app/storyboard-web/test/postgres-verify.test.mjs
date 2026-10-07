import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifyPath = fileURLToPath(new URL("./postgres/verify.mjs", import.meta.url));
const secret = "pw-do-not-print-9f3a";

function childEnv(overrides) {
  const env = { ...process.env };
  delete env.STORYBOARD_VERIFY_FILES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runVerify(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [verifyPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

function assertUrlHidden(output, url) {
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(url), false);
  assert.equal(output.includes("Cannot find module"), false);
}

test("verify exits 1 when STORYBOARD_TEST_DATABASE_URL is absent and does not print a URL", async () => {
  const databaseUrl = `postgres://comics:${secret}@127.0.0.1:5432/comics`;
  const result = await runVerify(childEnv({
    STORYBOARD_TEST_DATABASE_URL: undefined,
    DATABASE_URL: databaseUrl,
  }));
  assert.equal(result.status, 1);
  assert.match(result.output, /event=database-unavailable/);
  assertUrlHidden(result.output, databaseUrl);
});

test("verify exits 1 for the comics database and any other name without printing the URL", async () => {
  for (const name of ["comics", "other_db", "comics_test_extra"]) {
    const databaseUrl = `postgres://comics:${secret}@127.0.0.1:5432/${name}`;
    const result = await runVerify(childEnv({
      STORYBOARD_TEST_DATABASE_URL: databaseUrl,
    }));
    assert.equal(result.status, 1, name);
    assert.match(result.output, /event=database-unavailable/);
    assertUrlHidden(result.output, databaseUrl);
  }
});

test("verify exits 1 when the child reports zero tests or a skipped test", async () => {
  const databaseUrl = `postgres://comics:${secret}@127.0.0.1:5432/comics_test`;
  const directory = mkdtempSync(join(tmpdir(), "storyboard-verify-"));
  try {
    const empty = await runVerify(childEnv({
      STORYBOARD_TEST_DATABASE_URL: databaseUrl,
      STORYBOARD_VERIFY_FILES: join(directory, "*.test.mjs"),
    }));
    assert.equal(empty.status, 1);
    assert.match(empty.output, /event=verification-failed/);
    assertUrlHidden(empty.output, databaseUrl);

    const skippedFile = join(directory, "skipped.test.mjs");
    writeFileSync(skippedFile, [
      "import test from \"node:test\";",
      "test(\"skipped fixture\", { skip: \"fixture\" }, () => {});",
      "",
    ].join("\n"));
    const skipped = await runVerify(childEnv({
      STORYBOARD_TEST_DATABASE_URL: databaseUrl,
      STORYBOARD_VERIFY_FILES: skippedFile,
    }));
    assert.equal(skipped.status, 1);
    assert.match(skipped.output, /event=verification-failed/);
    assertUrlHidden(skipped.output, databaseUrl);

    const passingFile = join(directory, "passing.test.mjs");
    writeFileSync(passingFile, [
      "import test from \"node:test\";",
      "test(\"passing fixture\", () => {});",
      "",
    ].join("\n"));
    const passing = await runVerify(childEnv({
      STORYBOARD_TEST_DATABASE_URL: databaseUrl,
      STORYBOARD_VERIFY_FILES: passingFile,
    }));
    assert.equal(passing.status, 0);
    assertUrlHidden(passing.output, databaseUrl);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
