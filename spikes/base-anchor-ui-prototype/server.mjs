import { createPrototypeServer, DEFAULT_PORT, FORBIDDEN_PORT } from "./lib/create-server.mjs";

const port = Number(process.env.BASE_ANCHOR_PROTOTYPE_PORT || DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0 || port === FORBIDDEN_PORT) {
  console.error(`Refusing to listen on port ${port}. The storyboard app uses ${FORBIDDEN_PORT}.`);
  process.exit(1);
}

const server = createPrototypeServer();
server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Refusing to take over another service.`);
    process.exit(1);
  }
  console.error("Prototype server failed to start.");
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  const configured = Boolean(String(process.env.BASE_URL || "").trim() && String(process.env.CONTEST_API_TOKEN || "").trim());
  console.log(`Review URL: http://127.0.0.1:${port}/`);
  console.log("Endpoint: POST /api/generate");
  console.log(`Provider configuration present: ${configured ? "yes" : "no"}`);
  console.log("State boundary: accepted anchor in browser sessionStorage only; unfinished drafts stay in page memory; the product database is not used.");
});
