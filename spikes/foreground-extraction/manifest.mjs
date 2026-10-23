import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(file) {
  return sha256Buffer(readFileSync(file));
}

export function containedPath(rootReal, targetReal) {
  const rel = relative(rootReal, targetReal);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function assertRelativeResourcePath(resourcePath) {
  if (typeof resourcePath !== "string" || resourcePath.length === 0 || resourcePath.length > 240) {
    throw new Error("manifest resource path is empty");
  }
  if (resourcePath.includes("\0") || resourcePath.includes("\\") || isAbsolute(resourcePath)) {
    throw new Error(`manifest resource path is not relative: ${resourcePath}`);
  }
  const segments = resourcePath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`manifest resource path escapes its root: ${resourcePath}`);
    }
    if (segment === ".env" || segment.startsWith(".env")) {
      throw new Error(`manifest resource path names an env file: ${resourcePath}`);
    }
  }
}

function assertItem(item, roots) {
  if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
    throw new Error("manifest item id is invalid");
  }
  if (typeof item.root !== "string" || !Object.hasOwn(roots, item.root)) {
    throw new Error(`manifest item ${item.id} has an unknown root`);
  }
  if (!isAbsolute(roots[item.root])) {
    throw new Error(`manifest root ${item.root} must be absolute`);
  }
  assertRelativeResourcePath(item.path);
  if (!/^[a-f0-9]{64}$/.test(item.sha256 || "")) {
    throw new Error(`manifest item ${item.id} is missing sha256`);
  }
  if (item.corpus !== "contemporary-prompt-only" && item.corpus !== "historical-hard-case") {
    throw new Error(`manifest item ${item.id} has an unknown corpus`);
  }
}

export function loadManifest(file) {
  const bytes = readFileSync(file);
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.roots || !Array.isArray(parsed.items)) {
    throw new Error("manifest is missing roots or items");
  }
  const seen = new Set();
  const items = parsed.items.map((item) => {
    assertItem(item, parsed.roots);
    if (seen.has(item.id)) throw new Error(`duplicate manifest id ${item.id}`);
    seen.add(item.id);
    const rootReal = realpathSync(parsed.roots[item.root]);
    const resolved = resolve(rootReal, item.path);
    const resolvedReal = realpathSync(resolved);
    if (!containedPath(rootReal, resolvedReal)) {
      throw new Error(`manifest item ${item.id} escapes its root`);
    }
    return {
      ...item,
      alias: `${item.root}/${item.path}`,
      rootReal,
      resolvedPath: resolvedReal,
    };
  });
  return {
    id: parsed.id,
    version: parsed.version,
    description: parsed.description || "",
    roots: parsed.roots,
    items,
    hash: sha256Buffer(bytes),
  };
}

export function hashMismatches(manifest) {
  const mismatches = [];
  for (const item of manifest.items) {
    const actual = sha256File(item.resolvedPath);
    if (actual !== item.sha256) {
      mismatches.push({ id: item.id, alias: item.alias, expected: item.sha256, actual });
    }
  }
  return mismatches;
}
