/**
 * Disposable comics_test checkpoint for Feature 022.
 * Uses a loopback fake image provider. Does not read the owner database or port 4173.
 *
 * STORYBOARD_TEST_DATABASE_URL must name the database comics_test.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createPool } from "./db/pool.mjs";
import { migrate } from "./db/migrate.mjs";
import { generateImage } from "./image-provider.mjs";
import { createServer } from "./server.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error("STORYBOARD_TEST_DATABASE_URL is required and must name comics_test");
  process.exit(1);
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (databaseName !== "comics_test") {
  console.error("refusing non-test database");
  process.exit(1);
}

const PROJECT_ID = "02200000-0000-4000-8000-0000000000c1";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const sha = createHash("sha256").update(png).digest("hex");
const ids = {
  revision: "02200000-0000-4000-8000-0000000000d1",
  reading: "02200000-0000-4000-8000-0000000000d2",
  interpretation: "02200000-0000-4000-8000-0000000000d3",
  material: "02200000-0000-4000-8000-0000000000d4",
  character: "02200000-0000-4000-8000-0000000000d5",
  result: "02200000-0000-4000-8000-0000000000d6",
  version: "02200000-0000-4000-8000-0000000000d7",
  state: "02200000-0000-4000-8000-0000000000d8",
  current: "02200000-0000-4000-8000-0000000000e1",
  anchorAsset: "02200000-0000-4000-8000-0000000000e2",
  styleAsset: "02200000-0000-4000-8000-0000000000e3",
  anchor: "02200000-0000-4000-8000-0000000000e4",
  generation: "02200000-0000-4000-8000-0000000000e5",
};

const calls = [];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function cleanup(pool) {
  const statements = [
    "UPDATE panel_revision_session SET selected_candidate_id = NULL, accepted_candidate_id = NULL WHERE project_id = $1",
    "DELETE FROM panel_revision_candidate WHERE session_id IN (SELECT id FROM panel_revision_session WHERE project_id = $1)",
    "DELETE FROM panel_revision_session WHERE project_id = $1",
    "DELETE FROM image_generation_attempt WHERE project_id = $1",
    "DELETE FROM research_event WHERE project_id = $1",
    `UPDATE panel_visual_state SET current_generation_id = NULL
       WHERE storyboard_version_id IN (
         SELECT storyboard_version.id FROM storyboard_version
         JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
         JOIN material_state ON material_state.id = storyboard_result.material_state_id
         JOIN source_revision ON source_revision.id = material_state.source_revision_id
         WHERE source_revision.project_id = $1)`,
    "DELETE FROM panel_foreground_extraction WHERE project_id = $1",
    `DELETE FROM panel_generation WHERE panel_visual_state_id IN (
       SELECT panel_visual_state.id FROM panel_visual_state
       JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM panel_visual_state WHERE storyboard_version_id IN (
       SELECT storyboard_version.id FROM storyboard_version
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM visual_approval WHERE storyboard_version_id IN (
       SELECT storyboard_version.id FROM storyboard_version
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM storyboard_head WHERE storyboard_result_id IN (
       SELECT storyboard_result.id FROM storyboard_result
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM storyboard_version WHERE storyboard_result_id IN (
       SELECT storyboard_result.id FROM storyboard_result
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM storyboard_result WHERE material_state_id IN (
       SELECT material_state.id FROM material_state
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1)`,
    `DELETE FROM project_style_seed WHERE material_state_id = '${ids.material}'`,
    `DELETE FROM character_anchor_head WHERE material_state_id = '${ids.material}'`,
    `DELETE FROM character_anchor_version WHERE material_state_id = '${ids.material}'`,
    `DELETE FROM canonical_character WHERE material_state_id = '${ids.material}'`,
    "DELETE FROM visual_asset WHERE project_id = $1",
    "DELETE FROM material_state WHERE source_revision_id IN (SELECT id FROM source_revision WHERE project_id = $1)",
    "DELETE FROM interpretation WHERE source_revision_id IN (SELECT id FROM source_revision WHERE project_id = $1)",
    "DELETE FROM reading WHERE project_id = $1",
    "UPDATE project SET active_source_revision_id = NULL, active_material_state_id = NULL WHERE id = $1",
    "DELETE FROM source_revision WHERE project_id = $1",
    "DELETE FROM working_draft WHERE project_id = $1",
    "DELETE FROM project WHERE id = $1",
  ];
  for (const statement of statements) {
    const params = statement.includes("$1") ? [PROJECT_ID] : [];
    await pool.query(statement, params).catch(() => {});
  }
}

async function seed(client) {
  const frames = [{
    id: "frame-1",
    layout: "single",
    origin: "source",
    dialogueMode: "silent",
    speakerPanel: null,
    dialogue: "",
    panels: [{
      id: "panel-022",
      description: "Маша, крупный план, спокойное выражение лица, взгляд вправо, сплошной матовый фон",
    }],
  }];
  await client.query("INSERT INTO project (id, title) VALUES ($1, '022 panel revision checkpoint')", [PROJECT_ID]);
  await client.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, '022 checkpoint', $2)",
    [PROJECT_ID, randomUUID()],
  );
  await client.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'Маша говорит.')",
    [ids.revision, PROJECT_ID],
  );
  await client.query(
    "INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status) VALUES ($1, $2, 'Маша говорит.', $3, 'ready')",
    [ids.reading, PROJECT_ID, randomUUID()],
  );
  await client.query(
    "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
    [ids.interpretation, ids.revision, ids.reading],
  );
  await client.query(
    "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
    [ids.material, ids.revision, ids.interpretation],
  );
  await client.query(
    "UPDATE project SET active_source_revision_id = $2, active_material_state_id = $3 WHERE id = $1",
    [PROJECT_ID, ids.revision, ids.material],
  );
  await client.query(
    "INSERT INTO canonical_character (id, material_state_id, ordinal, name, included) VALUES ($1, $2, 0, 'Маша', true)",
    [ids.character, ids.material],
  );
  await client.query(
    "INSERT INTO storyboard_result (id, material_state_id, status, stage_payload) VALUES ($1, $2, 'checked', $3::jsonb)",
    [ids.result, ids.material, JSON.stringify({ frames })],
  );
  await client.query(
    "INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)",
    [ids.version, ids.result, JSON.stringify(frames)],
  );
  await client.query(
    "INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)",
    [ids.result, ids.version],
  );
  for (const [id, kind] of [[ids.anchorAsset, "base-anchor"], [ids.styleAsset, "base-anchor"], [ids.current, "panel-image"]]) {
    await client.query(
      `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes, provenance)
       VALUES ($1, $2, $3, 'image/png', 1, 1, $4, $5, $6, $7::jsonb)`,
      [id, PROJECT_ID, kind, png.length, sha, png, JSON.stringify({
        origin: "generation",
        subject: "Маша",
        intent: {
          framing: "close-up",
          upperBody: "visible shoulders and upper torso",
          gesture: "hands outside crop",
          headPose: "near-frontal head",
          gaze: "screen-right",
          expression: "calm",
          background: "solid-matte",
        },
      })],
    );
  }
  await client.query(
    `INSERT INTO character_anchor_version (
       id, material_state_id, character_name, output_asset_id, status, provenance, approved_at
     ) VALUES ($1, $2, 'Маша', $3, 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
    [ids.anchor, ids.material, ids.anchorAsset],
  );
  await client.query(
    "INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id) VALUES ($1, 'Маша', $2)",
    [ids.material, ids.anchor],
  );
  await client.query(
    "INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id) VALUES ($1, $2, $3)",
    [ids.material, ids.styleAsset, ids.anchor],
  );
  await client.query(
    `INSERT INTO panel_visual_state (
       id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
       current_asset_id, current_asset_origin
     ) VALUES ($1, $2, 'frame-1', 0, 'panel-022', 'Маша', $3, 'generation')`,
    [ids.state, ids.version, ids.current],
  );
  await client.query(
    `INSERT INTO panel_generation (
       id, panel_visual_state_id, anchor_version_id, resolved_description, instruction, status, output_asset_id
     ) VALUES ($1, $2, $3, 'Маша', '', 'ready', $4)`,
    [ids.generation, ids.state, ids.anchor, ids.current],
  );
  await client.query("UPDATE panel_visual_state SET current_generation_id = $2 WHERE id = $1", [ids.state, ids.generation]);
}

const fake = createHttpServer((req, res) => {
  if (req.url === "/counts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: calls.length }));
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    calls.push(1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: [
            { type: "text", text: "ok" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      }],
    }));
  });
});

const fakePort = await listen(fake);
const pool = createPool(databaseUrl);
await migrate({ connectionString: databaseUrl, logger: { log() {} } });
await cleanup(pool);
const client = await pool.connect();
try {
  await seed(client);
} finally {
  client.release();
}
await pool.end();

const env = {
  BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
  CONTEST_API_TOKEN: "checkpoint-fake-token",
  IMAGE_MODEL: "fake-image",
  IMAGE_TIMEOUT_MS: "5000",
  IMAGE_REFERENCE_STRATEGY: "passthrough",
  DATABASE_URL: databaseUrl,
};
process.env.DATABASE_URL = databaseUrl;
const app = createServer({
  env,
  imageGenerator: generateImage,
  logger: { log() {} },
  migrate: async () => {},
});
const appPort = await listen(app);
console.log(JSON.stringify({
  projectId: PROJECT_ID,
  url: `http://127.0.0.1:${appPort}/projects/${PROJECT_ID}`,
  appPort,
  fakePort,
  fakeCounts: `http://127.0.0.1:${fakePort}/counts`,
}));
