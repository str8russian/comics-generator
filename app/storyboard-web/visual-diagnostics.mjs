import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

export const MAX_DIAGNOSTICS_ARCHIVE_BYTES = 48 * 1024 * 1024;
export const MAX_DIAGNOSTICS_ENTRY_COUNT = 512;
const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

const MIME_EXTENSION = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/json": "json",
  "text/plain": "txt",
});

export function sanitizeFrameIdForFilename(frameId) {
  const cleaned = String(frameId ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.\./g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_")
    .replace(/\.\./g, "")
    .slice(0, 80);
  return cleaned || "frame";
}

export function diagnosticsAttachmentFilename(frameId) {
  return `frame-${sanitizeFrameIdForFilename(frameId)}-diagnostics.zip`;
}

export function extensionForMime(mime) {
  return MIME_EXTENSION[mime] || "bin";
}

export function stableStringify(value) {
  return `${stringifyStable(value)}\n`;
}

function stringifyStable(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyStable(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stringifyStable(value[key])}`);
  return `{${parts.join(",")}}`;
}

export function normalizeZipEntryPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 240) {
    throw new Error("invalid-zip-path");
  }
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("invalid-zip-path");
  }
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error("invalid-zip-path");
  }
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("invalid-zip-path");
  }
  return normalized;
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

/**
 * Deterministic in-process ZIP builder (STORE or DEFLATE).
 * Entry order follows the provided array; timestamps are fixed.
 */
export function buildZipArchive(entries, {
  compress = false,
  maxBytes = MAX_DIAGNOSTICS_ARCHIVE_BYTES,
  maxEntries = MAX_DIAGNOSTICS_ENTRY_COUNT,
} = {}) {
  if (!Array.isArray(entries)) throw new Error("invalid-zip-entries");
  if (entries.length > maxEntries) {
    const error = new Error("archive-too-large");
    error.kind = "invalid-request";
    throw error;
  }

  const prepared = [];
  let totalUncompressed = 0;
  for (const entry of entries) {
    const name = normalizeZipEntryPath(entry.path || entry.name);
    const data = Buffer.isBuffer(entry.bytes)
      ? entry.bytes
      : Buffer.from(entry.bytes == null ? "" : String(entry.bytes), "utf8");
    totalUncompressed += data.length;
    if (totalUncompressed > maxBytes) {
      const error = new Error("archive-too-large");
      error.kind = "invalid-request";
      throw error;
    }
    const compressed = compress ? deflateRawSync(data, { level: 6 }) : data;
    const method = compress ? 8 : 0;
    const checksum = crc32(data) >>> 0;
    prepared.push({ name, data, compressed, method, checksum });
  }

  prepared.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of prepared) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const local = Buffer.concat([
      u32(ZIP_LOCAL),
      u16(20),
      u16(0),
      u16(entry.method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(entry.checksum),
      u32(entry.compressed.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.compressed,
    ]);
    const central = Buffer.concat([
      u32(ZIP_CENTRAL),
      u16(20),
      u16(20),
      u16(0),
      u16(entry.method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(entry.checksum),
      u32(entry.compressed.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.concat([
    u32(ZIP_END),
    u16(0),
    u16(0),
    u16(prepared.length),
    u16(prepared.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ]);
  const archive = Buffer.concat([...locals, ...centrals, end]);
  if (archive.length > maxBytes) {
    const error = new Error("archive-too-large");
    error.kind = "invalid-request";
    throw error;
  }
  return archive;
}

/** Minimal ZIP reader for tests and byte/hash verification. */
export function readZipArchive(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature !== ZIP_LOCAL) break;
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported-zip-method:${method}`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error("zip-size-mismatch");
    }
    entries.set(name, data);
    offset = dataStart + compressedSize;
  }
  return entries;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function textEntry(path, text) {
  return { path, bytes: Buffer.from(String(text ?? ""), "utf8") };
}

function jsonEntry(path, value) {
  return textEntry(path, stableStringify(value));
}

function assetMeta(role, asset, extras = {}) {
  if (!asset) return null;
  return {
    role,
    assetId: asset.id,
    mime: asset.mime,
    width: asset.width ?? null,
    height: asset.height ?? null,
    byteLength: asset.byteLength ?? asset.bytes?.length ?? null,
    sha256: asset.sha256,
    ...extras,
  };
}

function sanitizeReferenceManifest(manifest) {
  if (!Array.isArray(manifest)) return [];
  return manifest.map((entry, index) => ({
    role: entry?.role ?? null,
    assetId: entry?.assetId ?? entry?.asset_id ?? null,
    required: Boolean(entry?.required),
    mime: entry?.mime ?? null,
    width: entry?.width ?? null,
    height: entry?.height ?? null,
    byteLength: entry?.byteLength ?? entry?.byte_length ?? null,
    sha256: entry?.sha256 ?? null,
    referenceIndex: Number.isInteger(entry?.referenceIndex) ? entry.referenceIndex : index,
    archivePath: entry?.archivePath ?? null,
  }));
}

function providerInvocationOccurred(generation) {
  // Evidence-based only: never invent a negative claim from ambiguous failures.
  // true  = reliable persisted evidence that provider I/O happened
  // null  = insufficient evidence to determine invocation
  // false = reserved for an explicit persisted fact that the provider was not invoked
  //         (no such fact exists in current records; conflict alone is insufficient)
  if (generation?.status === "ready") return true;
  const providerStatus = generation?.providerStatus;
  if (providerStatus != null && providerStatus !== "") return true;
  const latencyMs = generation?.latencyMs;
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) return true;
  return null;
}

function indexReferenceAssets(evidence) {
  const byId = new Map();
  for (const asset of evidence.referenceAssets || []) {
    if (asset?.id) byId.set(asset.id, asset);
  }
  return byId;
}

function sanitizeGenerationSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const allowed = ["aspectRatio", "component", "modalities", "timeoutMs", "panelIndex", "sceneKey"];
  const out = {};
  for (const key of allowed) {
    if (settings[key] != null) out[key] = settings[key];
  }
  return out;
}

function sanitizeErrorKind(kind) {
  return typeof kind === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(kind) ? kind : null;
}

const BLOCKED_EXPORT_KEY = /^(authorization|auth|bearer|cookie|set-cookie|token|api[-_]?key|api[-_]?token|password|secret|env|environment|database|connectionstring|providerurl|signedurl|url|href)$/i;

function sanitizeExportValue(value, depth = 0) {
  if (depth > 6) return null;
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^(bearer\s+)/i.test(value)) return null;
    if (/^[A-Za-z]+:\/\/[^\s]+@[^\s]+/.test(value)) return null;
    if (/[?&](signature|token|key|api_key)=/i.test(value)) return null;
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeExportValue(entry, depth + 1)).filter((entry) => entry !== null);
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_EXPORT_KEY.test(key)) continue;
    if (/envsnapshot|rawprovider|stacktrace/i.test(key)) continue;
    const cleaned = sanitizeExportValue(entry, depth + 1);
    if (cleaned !== null) out[key] = cleaned;
  }
  return out;
}

/**
 * Build a diagnostics ZIP from an allowlisted evidence object.
 * Never fabricates composites; never embeds absolute paths or secrets.
 */
export function buildDiagnosticsArchive(evidence) {
  if (!evidence?.ok) {
    const error = new Error(evidence?.kind || "not-found");
    error.kind = evidence?.kind || "not-found";
    throw error;
  }

  const entries = [];
  const assetManifest = [];

  const rootManifest = {
    storyboardResultId: evidence.storyboardResultId,
    storyboardVersionId: evidence.storyboardVersionId,
    frameId: evidence.frameId,
    visibleFrameNumber: evidence.visibleFrameNumber ?? null,
    visibleFrameId: evidence.visibleFrameId ?? evidence.frameId,
    panelIndices: (evidence.panels || []).map((panel) => panel.panelIndex),
    subjects: (evidence.panels || []).map((panel) => panel.subject ?? null),
    compositionMode: evidence.assembly?.compositionMode ?? null,
    sceneKey: evidence.assembly?.sceneKey ?? "primary",
    assemblyStatus: evidence.assembly?.assemblyStatus ?? null,
    appGitCommit: evidence.appGitCommit ?? null,
    specVersion: evidence.specVersion ?? "006-reproducible-hybrid-dialogue-frame",
    promptCompilerVersion: evidence.promptCompilerVersion ?? null,
    exportedAt: "1970-01-01T00:00:00.000Z",
    sharedBackground: evidence.sharedBackground ?? null,
  };
  entries.push(jsonEntry("manifest.json", rootManifest));

  entries.push(textEntry("briefs/grid.txt", evidence.briefs?.gridDescription ?? ""));
  entries.push(textEntry("briefs/detailed.txt", evidence.briefs?.detailedBrief ?? ""));

  const assemblyManifest = {
    status: evidence.assembly?.assemblyStatus ?? "not-ready",
    readiness: evidence.assembly?.readiness ?? null,
    compositionMode: evidence.assembly?.compositionMode ?? null,
    sceneKey: evidence.assembly?.sceneKey ?? "primary",
    activeOperationId: evidence.assembly?.activeOperationId ?? null,
    backgroundAssetId: evidence.assembly?.backgroundAssetId ?? null,
    characterAssetIds: evidence.assembly?.characterAssetIds ?? [],
    composite: evidence.composite?.present
      ? { present: true, assetId: evidence.composite.assetId }
      : {
        present: false,
        reason: evidence.composite?.reason || "no-deterministic-composite-stored",
      },
    pointers: evidence.assembly?.pointers ?? null,
  };
  entries.push(jsonEntry("assembly/manifest.json", assemblyManifest));

  for (const operation of evidence.operations || []) {
    const id = sanitizeFrameIdForFilename(operation.operationId);
    entries.push(jsonEntry(`operations/${id}.json`, {
      operationId: operation.operationId,
      frameId: operation.frameId,
      storyboardResultId: operation.storyboardResultId,
      storyboardVersionId: operation.storyboardVersionId,
      scope: operation.scope,
      panelIndex: operation.panelIndex ?? null,
      writeVersion: operation.writeVersion,
      phase: operation.phase,
      status: operation.status,
      errorKind: sanitizeErrorKind(operation.errorKind),
      componentFailures: Array.isArray(operation.componentFailures)
        ? operation.componentFailures.map((failure) => ({
          kind: sanitizeErrorKind(failure?.kind) || null,
          component: failure?.component ?? null,
          panelIndex: failure?.panelIndex ?? null,
        }))
        : [],
      createdAt: operation.createdAt ?? null,
      updatedAt: operation.updatedAt ?? null,
      finishedAt: operation.finishedAt ?? null,
    }));
  }

  const referenceAssetsById = indexReferenceAssets(evidence);
  const referenceOccurrences = [];
  const writtenReferenceAssets = new Map();

  for (const generation of evidence.generations || []) {
    const recordId = sanitizeFrameIdForFilename(generation.recordId);
    const base = `generations/${recordId}`;
    const invocationOccurred = providerInvocationOccurred(generation);
    const orderedRefs = Array.isArray(generation.referenceManifest) ? generation.referenceManifest : [];
    const perGenerationRefs = [];

    for (let referenceIndex = 0; referenceIndex < orderedRefs.length; referenceIndex += 1) {
      const entry = orderedRefs[referenceIndex];
      const assetId = entry?.assetId ?? entry?.asset_id ?? null;
      if (!assetId) {
        const error = new Error("reference-asset-missing");
        error.kind = "not-found";
        throw error;
      }
      const asset = referenceAssetsById.get(assetId);
      if (!asset?.bytes || !asset.mime || !asset.sha256) {
        const error = new Error("reference-asset-missing");
        error.kind = "not-found";
        throw error;
      }
      const bytes = Buffer.isBuffer(asset.bytes) ? asset.bytes : Buffer.from(asset.bytes);
      const digest = sha256Hex(bytes);
      if (digest !== asset.sha256) {
        const error = new Error("reference-asset-hash-mismatch");
        error.kind = "invalid-output";
        throw error;
      }
      const ext = extensionForMime(asset.mime);
      const archivePath = `references/assets/${asset.id}.${ext}`;
      normalizeZipEntryPath(archivePath);
      if (!writtenReferenceAssets.has(asset.id)) {
        writtenReferenceAssets.set(asset.id, archivePath);
        entries.push({ path: archivePath, bytes });
      }
      const occurrence = {
        generationRecordId: generation.recordId,
        referenceIndex,
        role: entry?.role ?? null,
        required: Boolean(entry?.required),
        assetId: asset.id,
        mime: asset.mime,
        width: asset.width ?? null,
        height: asset.height ?? null,
        byteLength: bytes.length,
        sha256: digest,
        archivePath,
        providerInvocationOccurred: invocationOccurred,
      };
      referenceOccurrences.push(occurrence);
      perGenerationRefs.push({
        role: occurrence.role,
        assetId: occurrence.assetId,
        required: occurrence.required,
        mime: occurrence.mime,
        width: occurrence.width,
        height: occurrence.height,
        byteLength: occurrence.byteLength,
        sha256: occurrence.sha256,
        referenceIndex,
        archivePath,
      });
    }

    entries.push(jsonEntry(`${base}/record.json`, {
      recordId: generation.recordId,
      operationType: generation.operationType,
      storyboardResultId: generation.storyboardResultId,
      storyboardVersionId: generation.storyboardVersionId,
      frameId: generation.frameId,
      panelIndex: generation.panelIndex ?? null,
      sceneKey: generation.sceneKey ?? null,
      componentGenerationId: generation.componentGenerationId ?? null,
      operationId: generation.operationId ?? null,
      status: generation.status,
      errorKind: sanitizeErrorKind(generation.errorKind),
      providerStatus: generation.providerStatus ?? null,
      latencyMs: generation.latencyMs ?? null,
      model: generation.model ?? null,
      promptCompilerVersion: generation.promptCompilerVersion ?? null,
      generationSettings: sanitizeGenerationSettings(generation.generationSettings),
      appGitCommit: generation.appGitCommit ?? null,
      outputAssetId: generation.outputAssetId ?? null,
      outputSha256: generation.outputSha256 ?? null,
      outputMime: generation.outputMime ?? null,
      outputWidth: generation.outputWidth ?? null,
      outputHeight: generation.outputHeight ?? null,
      outputByteLength: generation.outputByteLength ?? null,
      sharedBackground: Boolean(generation.sharedBackground),
      originatingFrameId: generation.originatingFrameId ?? null,
      originatingOperationId: generation.originatingOperationId ?? null,
      createdAt: generation.createdAt ?? null,
      finishedAt: generation.finishedAt ?? null,
      providerInvocationOccurred: invocationOccurred,
    }));
    entries.push(jsonEntry(`${base}/intent.json`, sanitizeExportValue(generation.visualIntent ?? {})));
    entries.push(textEntry(`${base}/compiled-prompt.txt`, generation.compiledPrompt ?? ""));
    entries.push(jsonEntry(`${base}/reference-manifest.json`, sanitizeReferenceManifest(perGenerationRefs)));
    entries.push(jsonEntry(`${base}/omitted-references.json`, sanitizeExportValue(
      Array.isArray(generation.omittedReferences) ? generation.omittedReferences : [],
    )));
  }

  entries.push(jsonEntry("references/manifest.json", { references: referenceOccurrences }));

  entries.push(jsonEntry("placement/panels.json", {
    panels: (evidence.panels || []).map((panel) => ({
      panelIndex: panel.panelIndex,
      subject: panel.subject ?? null,
      zoom: panel.zoom,
      positionX: panel.positionX,
      positionY: panel.positionY,
      fitMode: panel.fitMode,
      currentCharacterGenerationId: panel.currentCharacterGenerationId ?? null,
    })),
  }));

  for (const asset of evidence.assets || []) {
    if (!asset?.bytes || !asset.id || !asset.mime) continue;
    const bytes = Buffer.isBuffer(asset.bytes) ? asset.bytes : Buffer.from(asset.bytes);
    const digest = asset.sha256 || sha256Hex(bytes);
    if (digest !== sha256Hex(bytes)) {
      const error = new Error("asset-hash-mismatch");
      error.kind = "invalid-output";
      throw error;
    }
    const ext = extensionForMime(asset.mime);
    let path;
    if (asset.role === "background") {
      path = `assets/background/${asset.id}.${ext}`;
    } else if (asset.role === "character-raw") {
      path = `assets/character-raw/panel-${Number(asset.panelIndex)}-${asset.id}.${ext}`;
    } else if (asset.role === "character-rgba") {
      path = `assets/character-rgba/panel-${Number(asset.panelIndex)}-${asset.id}.${ext}`;
    } else if (asset.role === "composite") {
      path = `composites/${asset.id}.${ext}`;
    } else {
      continue;
    }
    normalizeZipEntryPath(path);
    entries.push({ path, bytes });
    assetManifest.push(assetMeta(asset.role, {
      id: asset.id,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.length,
      sha256: digest,
    }, {
      panelIndex: asset.panelIndex ?? null,
      generationId: asset.generationId ?? null,
      generationRecordId: asset.generationRecordId ?? null,
      kind: asset.kind ?? null,
    }));
  }

  entries.push(jsonEntry("assets/manifest.json", { assets: assetManifest }));

  const archive = buildZipArchive(entries, { compress: false });
  return {
    ok: true,
    bytes: archive,
    byteLength: archive.length,
    entryCount: entries.length,
    filename: diagnosticsAttachmentFilename(evidence.frameId),
    contentType: "application/zip",
    storyboardResultId: evidence.storyboardResultId,
    storyboardVersionId: evidence.storyboardVersionId,
    frameId: evidence.frameId,
  };
}
