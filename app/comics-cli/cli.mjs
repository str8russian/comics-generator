import { randomBytes } from "node:crypto";
import { CliError } from "./errors.mjs";
import { DEFAULT_TIMEOUTS, MANAGED_PORT_END, MANAGED_PORT_START } from "./constants.mjs";
import { discoverPrimary } from "./discover.mjs";
import { redact, secretsFromEnv } from "./redact.mjs";
import { cleanCommand, compareCommand, dbListCommand, dbShellCommand, listCommand, startCommand, stopCommand } from "./runs.mjs";

export const HELP = `Usage:
  comics start
  comics start <ref>
  comics start <ref> --fresh
  comics start <ref> --reuse <run-id>
  comics compare <ref-a> <ref-b>
  comics list
  comics stop <run-id>
  comics clean <run-id>
  comics db list
  comics db shell [<run-id>]
  comics help

The main run uses 127.0.0.1:4173 and database comics.
Managed runs use 127.0.0.1 and ports ${MANAGED_PORT_START}-${MANAGED_PORT_END}.
compare <ref-a> <ref-b> starts two managed runs and prints both URLs.
It does not diff commits, compare rendered output, or open a browser.
`;

function usage(message) {
  throw new CliError(message, { usage: true });
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) usage("usage: comics <command>");
  if (argv[0] === "help" || argv[0] === "--help") {
    if (argv.length !== 1) usage("unexpected arguments");
    return { command: "help" };
  }
  if (argv[0].startsWith("-")) usage(`unknown option '${argv[0]}'`);
  if (argv[0] === "list") {
    if (argv.length !== 1) usage("unexpected arguments");
    return { command: "list" };
  }
  if (argv[0] === "stop" || argv[0] === "clean") {
    if (argv.length !== 2) usage(`usage: comics ${argv[0]} <run-id>`);
    return { command: argv[0], runId: argv[1] };
  }
  if (argv[0] === "db") {
    if (argv.length < 2) usage("usage: comics db list|shell");
    if (argv[1] === "list") {
      if (argv.length !== 2) usage("unexpected arguments");
      return { command: "db-list" };
    }
    if (argv[1] === "shell") {
      if (argv.length > 3) usage("unexpected arguments");
      return { command: "db-shell", runId: argv[2] ?? null };
    }
    usage(`unknown command 'db ${argv[1]}'`);
  }
  if (argv[0] === "compare") {
    const positional = [];
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg.startsWith("-")) usage("usage: comics compare <ref-a> <ref-b>");
      positional.push(arg);
    }
    if (positional.length !== 2) usage("usage: comics compare <ref-a> <ref-b>");
    return { command: "compare", left: positional[0], right: positional[1] };
  }
  if (argv[0] !== "start") usage(`unknown command '${argv[0]}'`);
  const positional = [];
  let fresh = false;
  let reuse = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fresh") {
      if (fresh) usage("duplicate option '--fresh'");
      fresh = true;
      continue;
    }
    if (arg === "--reuse") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) usage("usage: comics start <ref> --reuse <run-id>");
      if (reuse) usage("duplicate option '--reuse'");
      reuse = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) usage(`unknown option '${arg}'`);
    positional.push(arg);
  }
  if (positional.length > 1) usage("unexpected arguments");
  const ref = positional[0] ?? null;
  if (!ref && (fresh || reuse)) usage("--fresh and --reuse require a ref");
  if (fresh && reuse) usage("--fresh and --reuse are mutually exclusive");
  if (!ref) return { command: "start", mode: "main" };
  return {
    command: "start",
    mode: fresh ? "fresh" : reuse ? "reuse" : "default",
    ref,
    reuse: reuse ?? null,
  };
}

function normalize(deps) {
  return {
    env: {},
    nodeVersion: process.versions.node,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date().toISOString(),
    randomBytes: (size) => randomBytes(size),
    callerCwd: null,
    ...deps,
    timeouts: { ...DEFAULT_TIMEOUTS, ...deps.timeouts },
  };
}

export async function execute(argv, deps = {}) {
  const normalized = normalize(deps);
  const secrets = secretsFromEnv(normalized.env);
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === "help") return { exitCode: 0, stdout: HELP, stderr: "" };
    const context = await discoverPrimary(normalized.packageRoot, normalized.execFile);
    if (parsed.command === "db-shell") {
      const shell = await dbShellCommand(parsed.runId, context, normalized, secrets);
      return { exitCode: 0, stdout: redact(shell.stdout, secrets), stderr: "", interactive: shell.interactive };
    }
    let stdout = "";
    if (parsed.command === "list") stdout = await listCommand(context, normalized);
    else if (parsed.command === "start") stdout = await startCommand(parsed, context, normalized, secrets);
    else if (parsed.command === "compare") stdout = await compareCommand(parsed, context, normalized, secrets);
    else if (parsed.command === "stop") stdout = await stopCommand(parsed.runId, context, normalized);
    else if (parsed.command === "clean") stdout = await cleanCommand(parsed.runId, context, normalized);
    else if (parsed.command === "db-list") stdout = await dbListCommand(context, normalized);
    else usage(`unknown command '${parsed.command}'`);
    return { exitCode: 0, stdout: redact(stdout, secrets), stderr: "" };
  } catch (error) {
    const message = error instanceof CliError ? error.message : "command failed";
    const stdout = error instanceof CliError ? error.stdout : "";
    const usageText = error instanceof CliError && error.usage ? `\n${HELP}` : "";
    return {
      exitCode: error instanceof CliError ? error.exitCode : 1,
      stdout: redact(stdout, secrets),
      stderr: `comics: ${redact(message, secrets)}\n${usageText}`,
    };
  }
}
