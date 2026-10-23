import sharp from "sharp";
import { requireProjectId } from "../project-scope.mjs";
import { EXTRACTION_CONFIG } from "./config.mjs";
import { decodeImage } from "./decode.mjs";
import { extractForeground } from "./extract.mjs";

export const EXTRACTION_EXCEPTION_CODE = "extraction-exception";

export async function defaultExtractPanel(bytes) {
  const decoded = await decodeImage(bytes);
  const result = extractForeground(decoded);
  return { decoded, result };
}

export function stableFindings(findings) {
  return (Array.isArray(findings) ? findings : []).map((finding) => {
    const stored = { code: finding.code, level: finding.level };
    if (finding.detail != null) stored.detail = finding.detail;
    return stored;
  });
}

export async function encodeForegroundPng(decoded, rgba) {
  return sharp(Buffer.from(rgba), {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
  }).png().toBuffer();
}

function elapsedMs(started) {
  return Math.round(Number(process.hrtime.bigint() - started) / 1e6);
}

async function insertExtraction(client, row) {
  await client.query(`
    INSERT INTO panel_foreground_extraction (
      source_asset_id, project_id, foreground_asset_id,
      extractor_version, contract_version, status, findings, timing_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    ON CONFLICT (source_asset_id) DO NOTHING
  `, [
    row.sourceAssetId,
    row.projectId,
    row.foregroundAssetId,
    row.extractorVersion,
    row.contractVersion,
    row.status,
    JSON.stringify(row.findings),
    row.timingMs,
  ]);
}

/**
 * Store a foreground PNG when extraction passes, and always store metadata.
 * Exceptions degrade to a failed record and do not propagate.
 */
export async function attachPanelForeground(client, {
  sourceAsset,
  bytes,
  contractVersion = null,
  insertAsset,
  runExtraction = defaultExtractPanel,
}) {
  const projectId = requireProjectId();
  const started = process.hrtime.bigint();
  try {
    const { decoded, result } = await runExtraction(bytes);
    const pass = result?.status === "candidate-pass" && result.rgba;
    let foregroundAssetId = null;
    if (pass) {
      const png = await encodeForegroundPng(decoded, result.rgba);
      const inserted = await insertAsset(client, "panel-foreground", { bytes: png }, {
        sourceAssetId: sourceAsset.id,
      });
      foregroundAssetId = inserted.id;
    }
    const status = pass
      ? "candidate-pass"
      : (result?.status === "review" || result?.status === "reject" ? result.status : "failed");
    const findings = stableFindings(result?.findings);
    await insertExtraction(client, {
      sourceAssetId: sourceAsset.id,
      projectId,
      foregroundAssetId: status === "candidate-pass" ? foregroundAssetId : null,
      extractorVersion: result?.config?.version || EXTRACTION_CONFIG.version,
      contractVersion,
      status,
      findings: findings.length ? findings : [{ code: EXTRACTION_EXCEPTION_CODE, level: "reject" }],
      timingMs: elapsedMs(started),
    });
    return { ok: true, status, foregroundAssetId: status === "candidate-pass" ? foregroundAssetId : null };
  } catch {
    try {
      await insertExtraction(client, {
        sourceAssetId: sourceAsset.id,
        projectId,
        foregroundAssetId: null,
        extractorVersion: EXTRACTION_CONFIG.version,
        contractVersion,
        status: "failed",
        findings: [{ code: EXTRACTION_EXCEPTION_CODE, level: "reject" }],
        timingMs: elapsedMs(started),
      });
    } catch {
      // The generated or uploaded original must still commit.
    }
    return { ok: true, status: "failed", foregroundAssetId: null };
  }
}
