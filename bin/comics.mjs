#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../app/comics-cli/cli.mjs";
import { createRealDependencies } from "../app/comics-cli/real-deps.mjs";

const here = realpathSync(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(here));
const outcome = await execute(process.argv.slice(2), createRealDependencies({ packageRoot }));
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
if (outcome.interactive) {
  const code = await outcome.interactive();
  process.exit(code ?? 1);
}
process.exit(outcome.exitCode ?? 1);
