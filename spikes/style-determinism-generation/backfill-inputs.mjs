import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backfillRunInputs } from "./lib/backfill.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.run || !args["source-a"] || !args["source-b"] || !args["style-reference"]) {
  console.error("Usage: backfill-inputs.mjs --run <id> --source-a <file> --source-b <file> --style-reference <file>");
  process.exit(2);
}
const result = await backfillRunInputs({
  runDir: join(root, "results", args.run),
  files: {
    "source-a": args["source-a"],
    "source-b": args["source-b"],
    "style-reference": args["style-reference"],
  },
});
console.log(JSON.stringify({ ok: result.ok, providerCalls: result.providerCalls, reason: result.reason || null, runId: result.runId || args.run }));
process.exit(result.ok ? 0 : 2);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) continue;
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}
