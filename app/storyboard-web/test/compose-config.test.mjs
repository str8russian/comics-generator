import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function readProjectFile(name) {
  if (name === ".env.local" || name.endsWith("/.env.local")) {
    throw new Error("refusing to read .env.local");
  }
  return readFileSync(join(root, name), "utf8");
}

function serviceBlocks(compose) {
  const lines = compose.split(/\r?\n/);
  const services = new Map();
  let inServices = false;
  let name = null;
  let body = [];
  const flush = () => {
    if (name) services.set(name, body.join("\n"));
  };
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^[a-zA-Z]/.test(line)) {
      flush();
      break;
    }
    if (/^  [a-zA-Z0-9_-]+:\s*$/.test(line)) {
      flush();
      name = line.trim().replace(/:$/, "");
      body = [];
      continue;
    }
    if (name) body.push(line);
  }
  flush();
  return services;
}

test("gitignore contains .env.local", () => {
  const lines = readProjectFile(".gitignore").split(/\r?\n/);
  assert.equal(lines.includes(".env.local"), true);
});

test("dockerignore contains .env.local", () => {
  const lines = readProjectFile(".dockerignore").split(/\r?\n/);
  assert.equal(lines.includes(".env.local"), true);
});

test("Dockerfile uses node 24 and does not copy .env.local", () => {
  const dockerfile = readProjectFile("Dockerfile");
  assert.match(dockerfile, /\bnode:24\b/);
  assert.equal(dockerfile.includes(".env.local"), false);
  for (const line of dockerfile.split(/\r?\n/)) {
    if (/^\s*(COPY|ADD)\b/i.test(line)) {
      assert.equal(line.includes(".env.local"), false, line);
    }
  }
});

test("compose keeps the env file off the database image and creates comics_test", () => {
  const compose = readProjectFile("docker-compose.yml");
  const services = serviceBlocks(compose);
  const database = services.get("db");
  const app = services.get("app");
  assert.ok(database, "database service db");
  assert.ok(app, "app service");
  assert.match(database, /image:\s*postgres:16\s*(?:#.*)?$/m);
  assert.equal(database.includes("env_file"), false);
  assert.match(app, /path:\s*\.env\.local\b/);
  assert.match(app, /required:\s*false\b/);
  assert.match(app, /DATABASE_URL:\s*postgres:\/\/comics:comics@db:5432\/comics\s*(?:#.*)?$/m);
  assert.match(database, /docker\/postgres\/init-test-db\.sql/);
  for (const [name, body] of services) {
    if (name !== "app") assert.equal(body.includes("env_file"), false, name);
  }
  const initSql = readProjectFile("docker/postgres/init-test-db.sql");
  assert.match(initSql, /CREATE DATABASE comics_test\b/);
});

test("package.json declares Node 24 and locks pg", () => {
  const pkg = JSON.parse(readProjectFile("package.json"));
  assert.equal(pkg.engines?.node, ">=24");
  assert.ok(pkg.dependencies?.pg);
  const lock = JSON.parse(readProjectFile("package-lock.json"));
  assert.ok(lock.packages?.["node_modules/pg"]);
});
