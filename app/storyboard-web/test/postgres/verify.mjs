import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const postgresDir = fileURLToPath(new URL("./", import.meta.url));
const defaultFiles = [join(postgresDir, "*.test.mjs")];

function databaseName(connectionString) {
  try {
    const url = new URL(connectionString);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function refuse() {
  console.error("storyboard event=database-unavailable");
  process.exit(1);
}

const connectionString = process.env.STORYBOARD_TEST_DATABASE_URL;
if (typeof connectionString !== "string" || connectionString.length === 0) refuse();
if (databaseName(connectionString) !== "comics_test") refuse();

const configured = process.env.STORYBOARD_VERIFY_FILES;
const files = configured
  ? configured.split(delimiter).filter(Boolean)
  : defaultFiles;

const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
  if (key.startsWith("NODE_TEST_")) delete childEnv[key];
}

const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...files], {
  cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

child.on("close", (status) => {
  const tests = lastCount(output, "tests");
  const skipped = lastCount(output, "skipped");
  if (status !== 0 || tests == null || tests === 0 || skipped == null || skipped !== 0) {
    console.error("storyboard event=verification-failed");
    process.exit(1);
  }
  process.exit(0);
});

child.on("error", () => {
  console.error("storyboard event=verification-failed");
  process.exit(1);
});

function lastCount(tap, label) {
  const matches = [...tap.matchAll(new RegExp(`^# ${label} (\\d+)$`, "gm"))];
  if (matches.length === 0) return null;
  return Number(matches.at(-1)[1]);
}
