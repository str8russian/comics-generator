import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REVIEW_HOST, REVIEW_PORT } from "./lib/constants.mjs";
import { createReviewServer, listenReviewServer } from "./lib/review-server.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const runId = await selectedRunId(root, process.argv.slice(2));
if (!/^(?:fake-smoke|sdg-\d{8}T\d{6}Z)$/.test(runId || "")) {
  console.error("No local run is selected. Start a fake or live run, then open the review page.");
  process.exit(2);
}
const server = createReviewServer({ runDir: join(root, "results", runId) });
try {
  const address = await listenReviewServer(server, { host: REVIEW_HOST, port: REVIEW_PORT });
  console.log(`http://${address.address}:${address.port}/`);
} catch (error) {
  console.error(error?.code === "EADDRINUSE" ? "127.0.0.1:4193 is already in use" : "The review server failed to start");
  process.exit(1);
}

async function selectedRunId(spikeRoot, argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run") return argv[index + 1] || "";
  }
  try {
    return (await readFile(join(spikeRoot, "results", "LATEST"), "utf8")).trim();
  } catch {
    return "";
  }
}
