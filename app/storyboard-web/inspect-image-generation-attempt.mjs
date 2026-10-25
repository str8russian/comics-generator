import { pathToFileURL } from "node:url";
import pg from "pg";
import { readImageGenerationAttempts } from "./image-generation-trace.mjs";

function fail(code) {
  process.stderr.write(`storyboard event=image-trace-inspect status=failed code=${code}\n`);
  process.exitCode = 1;
}

function selectorFromArgs(argv) {
  const flags = [
    ["--attempt", "attemptId"],
    ["--panel-generation", "panelGenerationId"],
    ["--correlation", "correlationId"],
    ["--anchor-version", "anchorVersionId"],
  ];
  const found = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = flags.find(([name]) => name === argv[index]);
    if (!flag) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return null;
    found.push([flag[1], value]);
    index += 1;
  }
  if (found.length !== 1) return null;
  return { [found[0][0]]: found[0][1] };
}

export async function inspectImageGenerationAttempts({ connectionString, selector, stdout = process.stdout }) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const attempts = await readImageGenerationAttempts(client, selector);
    await client.query("COMMIT");
    stdout.write(`${JSON.stringify({ attempts }, null, 2)}\n`);
    return attempts.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const selector = selectorFromArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!selector || typeof connectionString !== "string" || connectionString.length === 0) {
    process.stderr.write("usage: inspect-image-generation-attempt.mjs (--attempt|--panel-generation|--correlation|--anchor-version) <uuid>\n");
    process.exitCode = 2;
    return;
  }
  let count = 0;
  try {
    count = await inspectImageGenerationAttempts({ connectionString, selector });
  } catch {
    fail("database");
    return;
  }
  if (count === 0) fail("not-found");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
