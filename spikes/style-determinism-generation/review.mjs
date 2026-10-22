import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REVIEW_HOST, REVIEW_PORT } from "./lib/constants.mjs";
import { CROSS_IDENTITY_REVIEW_PORT } from "./lib/cross-identity.mjs";
import { createReviewServer, listenReviewServer } from "./lib/review-server.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const crossIdentity = args.profile === "cross-identity";
const port = crossIdentity ? CROSS_IDENTITY_REVIEW_PORT : REVIEW_PORT;
const runId = await selectedRunId(root, args.run);
if (!(crossIdentity ? /^(?:fake-cross|sdc-\d{8}T\d{6}Z)$/ : /^(?:fake-smoke|sdg-\d{8}T\d{6}Z)$/).test(runId || "")) {
  console.error("No local run is selected. Start a fake or live run, then open the review page.");
  process.exit(2);
}
const server = createReviewServer({ runDir: join(root, "results", runId) });
try {
  const address = await listenReviewServer(server, { host: REVIEW_HOST, port });
  console.log(`http://${address.address}:${address.port}/`);
} catch (error) {
  console.error(error?.code === "EADDRINUSE" ? `127.0.0.1:${port} is already in use` : "The review server failed to start");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { profile: null, run: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--profile") args.profile = argv[index + 1] || "";
    if (argv[index] === "--run") args.run = argv[index + 1] || "";
  }
  if (args.profile && args.profile !== "cross-identity") {
    console.error("Unknown review profile");
    process.exit(2);
  }
  return args;
}

async function selectedRunId(spikeRoot, run) {
  if (run) return run;
  try {
    return (await readFile(join(spikeRoot, "results", "LATEST"), "utf8")).trim();
  } catch {
    return "";
  }
}
