import { pathToFileURL } from "node:url";
import { createPool } from "./db/pool.mjs";
import { attachPanelForeground } from "./foreground/persist.mjs";
import { withProject } from "./project-scope.mjs";
import { insertAsset } from "./visual-store.mjs";

const PROJECT_FLAG = "--project";
const APPLY_FLAG = "--apply";

export function parseBackfillArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const projectIndex = args.indexOf(PROJECT_FLAG);
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : "";
  return {
    projectId: typeof projectId === "string" ? projectId : "",
    apply: args.includes(APPLY_FLAG),
  };
}

export async function backfillPanelForeground(pool, { projectId, apply = false } = {}) {
  return withProject(projectId, async () => {
    const client = await pool.connect();
    try {
      const pending = await client.query(`
        SELECT id, bytes
        FROM visual_asset
        WHERE project_id = $1
          AND kind IN ('panel-image', 'uploaded-image')
          AND NOT EXISTS (
            SELECT 1 FROM panel_foreground_extraction
            WHERE panel_foreground_extraction.source_asset_id = visual_asset.id
          )
        ORDER BY created_at, id
      `, [projectId]);
      if (!apply) {
        return { ok: true, apply: false, projectId, pending: pending.rowCount, written: 0 };
      }
      let written = 0;
      for (const row of pending.rows) {
        await attachPanelForeground(client, {
          sourceAsset: { id: row.id },
          bytes: row.bytes,
          contractVersion: null,
          insertAsset,
        });
        written += 1;
      }
      return { ok: true, apply: true, projectId, pending: pending.rowCount, written };
    } finally {
      client.release();
    }
  });
}

async function main() {
  const { projectId, apply } = parseBackfillArgs(process.argv.slice(2));
  if (!projectId) {
    console.error("Usage: node app/storyboard-web/backfill-panel-foreground.mjs --project <uuid> [--apply]");
    process.exitCode = 2;
    return;
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const result = await backfillPanelForeground(pool, { projectId, apply });
    if (!result?.ok) {
      console.error(result?.kind || "backfill-failed");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      apply: result.apply,
      projectId: result.projectId,
      pending: result.pending,
      written: result.written,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.code || error?.message || "backfill-failed");
    process.exitCode = 1;
  });
}
