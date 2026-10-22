import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { migrate } from "../../db/migrate.mjs";
import { createProject, duplicateProject } from "../../project-catalog.mjs";
import { enterProject } from "../../project-scope.mjs";
import {
  beginReading,
  confirmReading,
  finishReading,
  loadProject,
  replacePendingCast,
  reviseMaterialState,
  reviseSourceUtterance,
  saveDraft,
} from "../../project-store.mjs";
import { createRenderController } from "../../render-service.mjs";
import { createResearchStore } from "../../research-store.mjs";
import { compileVideoSpec } from "../../video-spec.mjs";
import { createPool } from "../../db/pool.mjs";
import { createVisualStore, readAsset } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const line = "Путин: Дмитрий Сергеевич, это Песков.";
const spoken = "Дмитрий Сергеевич, это Песков.";
const second = "Кто это сказал?";
const draft = `${line}\n${second}`;
const editedSpoken = "Дмитрий Сергеевич, это Песков, короче.";

function assertOk(result, label) {
  assert.equal(result?.ok, true, `${label}: ${result?.kind || result?.message || result?.status || "failed"}`);
}

function sourceItems() {
  return [
    {
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: line,
      draftStart: 0,
      draftEnd: line.length,
      text: spoken,
    },
    {
      id: "u2",
      kind: "utterance",
      segmentIds: ["seg-1"],
      speakerStatus: "unresolved",
      sourceQuote: second,
      draftStart: line.length + 1,
      draftEnd: draft.length,
      text: second,
    },
  ];
}

function people() {
  return {
    characters: [
      { id: "putin", name: "Путин" },
      { id: "peskov", name: "Песков" },
    ],
    surfaceForms: [
      { id: "label", quote: "Путин", role: "speaker-label", characterId: "putin" },
      { id: "address", quote: "Дмитрий Сергеевич", role: "address" },
      { id: "mention", quote: "Песков", role: "mention", characterId: "peskov" },
    ],
  };
}

function cast() {
  return {
    characters: [
      { name: "Путин", extractedName: "Путин", included: true },
      { name: "Песков", extractedName: "Песков", included: true },
    ],
    aliases: [
      { surface: "Путин", characterName: "Путин" },
      { surface: "Дмитрий Сергеевич", characterName: "Песков" },
      { surface: "Песков", characterName: "Песков" },
    ],
    speakers: [{ sourceItemId: "u1", characterName: "Путин" }],
  };
}

function frames() {
  return [
    {
      id: "f1",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: spoken,
      durationFrames: 180,
      displayBlock: { sourceItemId: "u1", start: 0, end: spoken.length },
      panels: [{ id: "p1", description: "Путин" }],
    },
    {
      id: "f2",
      sourceItemId: "u2",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: second,
      durationFrames: 120,
      displayBlock: { sourceItemId: "u2", start: 0, end: second.length },
      panels: [{ id: "p2", description: "Песков" }],
    },
    {
      id: "f-silent",
      origin: "manual",
      layout: "single",
      dialogueMode: "silent",
      speakerPanel: null,
      dialogue: "",
      durationFrames: 36,
      panels: [{ id: "p-silent", description: "Путин" }],
    },
    {
      id: "f-hidden",
      origin: "manual",
      layout: "single",
      frameKind: "image",
      dialogueMode: "hidden",
      speakerPanel: null,
      dialogue: "скрытая реплика",
      durationFrames: 24,
      panels: [{ id: "p-hidden", description: "Песков" }],
    },
    {
      id: "f-card",
      origin: "manual",
      frameKind: "text",
      textCard: "Пауза",
      durationFrames: 30,
      panels: [],
    },
  ];
}

function researchContext() {
  return {
    workflowPhase: "visual",
    storyboardVersionId: null,
    displayFrameNumber: null,
    displayFrameId: null,
    structureFrameId: null,
    structureSegmentIndex: null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
    panelId: null,
    transitionMode: null,
    transitionOverlapFrames: null,
    introTemplateId: null,
    introTemplateVersion: null,
  };
}

function materialShape(project) {
  return {
    items: project.material.sourceItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      speakerStatus: item.speakerStatus,
      speakerLabel: item.speakerLabel ?? null,
      sourceQuote: item.sourceQuote,
      text: item.text,
    })),
    characters: project.material.cast.characters,
    aliases: project.material.cast.aliases,
    speakers: project.material.cast.speakers,
  };
}

function visualShape(visual) {
  return {
    approved: visual.approved,
    readyForVideo: visual.readyForVideo,
    frames: visual.frames.map((frame) => ({
      id: frame.id,
      dialogueMode: frame.dialogueMode ?? null,
      dialogue: frame.dialogue ?? "",
      durationFrames: frame.durationFrames ?? null,
      textCard: frame.textCard ?? null,
      frameKind: frame.frameKind ?? null,
      speakerPanel: frame.speakerPanel ?? null,
      panels: frame.panels.map((panel) => ({
        id: panel.id,
        subject: panel.subject,
        zoom: panel.zoom,
        positionX: panel.positionX,
        positionY: panel.positionY,
        mirrored: panel.mirrored === true,
        origin: panel.assignmentOrigin,
        hasAsset: Boolean(panel.assetId),
      })),
    })),
    characters: visual.characters.map((character) => ({
      name: character.name,
      anchorProvenance: character.anchorProvenance,
      approved: Boolean(character.approvedAnchorId),
      sourcePhoto: Boolean(character.sourcePhoto),
    })),
  };
}

async function purgeProject(client, projectId) {
  await client.query("BEGIN");
  await client.query(
    `UPDATE project
     SET active_source_revision_id = NULL, active_material_state_id = NULL, current_reading_id = NULL
     WHERE id = $1`,
    [projectId],
  );
  const revisions = await client.query(`SELECT id FROM source_revision WHERE project_id = $1`, [projectId]);
  const revisionIds = revisions.rows.map((row) => row.id);
  const readings = await client.query(`SELECT id FROM reading WHERE project_id = $1`, [projectId]);
  const readingIds = readings.rows.map((row) => row.id);
  const materials = revisionIds.length
    ? await client.query(`SELECT id FROM material_state WHERE source_revision_id = ANY($1::uuid[])`, [revisionIds])
    : { rows: [] };
  const materialIds = materials.rows.map((row) => row.id);
  const results = materialIds.length
    ? await client.query(`SELECT id FROM storyboard_result WHERE material_state_id = ANY($1::uuid[])`, [materialIds])
    : { rows: [] };
  const resultIds = results.rows.map((row) => row.id);
  const versions = resultIds.length
    ? await client.query(`SELECT id FROM storyboard_version WHERE storyboard_result_id = ANY($1::uuid[])`, [resultIds])
    : { rows: [] };
  const versionIds = versions.rows.map((row) => row.id);
  if (versionIds.length) {
    await client.query(`DELETE FROM visual_approval WHERE storyboard_version_id = ANY($1::uuid[])`, [versionIds]);
    await client.query(
      `UPDATE panel_visual_state SET current_generation_id = NULL WHERE storyboard_version_id = ANY($1::uuid[])`,
      [versionIds],
    );
    await client.query(
      `DELETE FROM panel_generation WHERE panel_visual_state_id IN (
         SELECT id FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])
       )`,
      [versionIds],
    );
    await client.query(`DELETE FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])`, [versionIds]);
  }
  if (resultIds.length) {
    await client.query(`DELETE FROM storyboard_reusable_asset WHERE storyboard_result_id = ANY($1::uuid[])`, [resultIds]);
    await client.query(`DELETE FROM storyboard_head WHERE storyboard_result_id = ANY($1::uuid[])`, [resultIds]);
  }
  if (versionIds.length) {
    await client.query(`UPDATE storyboard_version SET parent_storyboard_version_id = NULL WHERE id = ANY($1::uuid[])`, [versionIds]);
    await client.query(`DELETE FROM storyboard_version WHERE id = ANY($1::uuid[])`, [versionIds]);
  }
  if (resultIds.length) await client.query(`DELETE FROM storyboard_result WHERE id = ANY($1::uuid[])`, [resultIds]);
  if (materialIds.length) {
    await client.query(`DELETE FROM project_style_seed WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM character_anchor_head WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(
      `UPDATE character_anchor_version SET parent_anchor_version_id = NULL WHERE material_state_id = ANY($1::uuid[])`,
      [materialIds],
    );
    await client.query(`DELETE FROM character_anchor_version WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM character_identity WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM speaker_assignment WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM alias WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM canonical_character WHERE material_state_id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`UPDATE material_state SET parent_material_state_id = NULL WHERE id = ANY($1::uuid[])`, [materialIds]);
    await client.query(`DELETE FROM material_state WHERE id = ANY($1::uuid[])`, [materialIds]);
  }
  if (revisionIds.length) {
    const interpretations = await client.query(
      `SELECT id FROM interpretation WHERE source_revision_id = ANY($1::uuid[])`,
      [revisionIds],
    );
    const interpretationIds = interpretations.rows.map((row) => row.id);
    if (interpretationIds.length) {
      await client.query(`DELETE FROM source_item WHERE interpretation_id = ANY($1::uuid[])`, [interpretationIds]);
      await client.query(`DELETE FROM provisional_character WHERE interpretation_id = ANY($1::uuid[])`, [interpretationIds]);
      await client.query(`DELETE FROM surface_form WHERE interpretation_id = ANY($1::uuid[])`, [interpretationIds]);
      await client.query(`DELETE FROM interpretation WHERE id = ANY($1::uuid[])`, [interpretationIds]);
    }
  }
  if (revisionIds.length) {
    await client.query(`UPDATE source_revision SET parent_source_revision_id = NULL WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM source_revision WHERE project_id = $1`, [projectId]);
  }
  if (readingIds.length) {
    await client.query(`DELETE FROM pending_speaker WHERE reading_id = ANY($1::uuid[])`, [readingIds]);
    await client.query(`DELETE FROM pending_alias WHERE reading_id = ANY($1::uuid[])`, [readingIds]);
    await client.query(`DELETE FROM pending_character WHERE reading_id = ANY($1::uuid[])`, [readingIds]);
    await client.query(`DELETE FROM reading WHERE project_id = $1`, [projectId]);
  }
  await client.query(`DELETE FROM visual_asset WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM research_event WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM character_exclusion WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM working_draft WHERE project_id = $1`, [projectId]);
  await client.query(`DELETE FROM project WHERE id = $1`, [projectId]);
  await client.query("COMMIT");
}

async function assetIds(pool, projectId) {
  const rows = await pool.query(`SELECT id, sha256 FROM visual_asset WHERE project_id = $1`, [projectId]);
  return rows.rows;
}

test("a populated project duplicates as an independent current snapshot", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const created = [];
  const renderDir = await mkdtemp(path.join(tmpdir(), "project-duplication-"));
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const createdProject = await createProject(pool);
    assertOk(createdProject, "create");
    const sourceId = createdProject.project.id;
    created.push(sourceId);
    enterProject(sourceId);
    const empty = await loadProject(pool);
    assertOk(await saveDraft(pool, { text: draft, revisionToken: empty.draft.revisionToken }), "draft");
    const started = await beginReading(pool);
    assertOk(started, "reading");
    const model = people();
    assertOk(await finishReading(pool, {
      readingId: started.readingId,
      sourceItems: sourceItems(),
      characters: model.characters,
      surfaceForms: model.surfaceForms,
    }), "finish");
    assertOk(await replacePendingCast(pool, started.readingId, cast()), "cast");
    const confirmed = await confirmReading(pool, { readingId: started.readingId });
    assertOk(confirmed, "confirm");

    const storyboardFrames = frames();
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
       VALUES (gen_random_uuid(), $1, 'checked', $2::jsonb, '2020-01-01T00:00:00Z')`,
      [confirmed.materialStateId, JSON.stringify({ frames: [{ id: "stale-frame", dialogue: "СТАРАЯ-РАСКАДРОВКА", panels: [] }] })],
    );
    const resultId = (await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES (gen_random_uuid(), $1, 'checked', $2::jsonb)
       RETURNING id`,
      [confirmed.materialStateId, JSON.stringify({ frames: storyboardFrames })],
    )).rows[0].id;
    const versionId = (await pool.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames)
       VALUES (gen_random_uuid(), $1, $2::jsonb)
       RETURNING id`,
      [resultId, JSON.stringify(storyboardFrames)],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [resultId, versionId],
    );
    await pool.query(
      `INSERT INTO character_exclusion (project_id, extracted_name) VALUES ($1, 'Лишний')`,
      [sourceId],
    );

    const store = createVisualStore(pool);
    const putin = await store.acceptSessionAnchor({
      characterName: "Путин",
      provenance: "generated_from_source",
      image: { bytes: png },
      sourceImage: { bytes: png },
      instruction: "контур",
    });
    assertOk(putin, "putin-anchor");
    const peskov = await store.acceptSessionAnchor({
      characterName: "Песков",
      provenance: "uploaded_as_ready_anchor",
      image: { bytes: png },
      instruction: "",
    });
    assertOk(peskov, "peskov-anchor");
    const orphanSha = createHash("sha256").update(png).digest("hex");
    const orphan = (await pool.query(
      `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes)
       VALUES (gen_random_uuid(), $1, 'uploaded-image', 'image/png', 1, 1, $2, $3, $4)
       RETURNING id`,
      [sourceId, png.length, orphanSha, png],
    )).rows[0].id;
    const styled = await store.load();
    assert.equal(styled.ok, true);
    const targets = [
      ["f1", 0, true],
      ["f2", 0, false],
      ["f-silent", 0, false],
      ["f-hidden", 0, false],
    ];
    for (const [frameId, panelIndex, withProvenance] of targets) {
      const pending = await store.beginPanelGeneration({
        frameId,
        panelIndex,
        instruction: "кадр",
        performanceImage: withProvenance ? { bytes: png } : null,
      });
      assertOk(pending, `begin-${frameId}`);
      const finished = await store.finishPanelGeneration({
        id: pending.id,
        result: { ok: true, image: { bytes: png }, metadata: { provider: "hidden" } },
        provenance: withProvenance ? {
          origin: "generation",
          subject: "Путин",
          description: "Путин",
          storyboardResultId: resultId,
          anchorVersionId: putin.anchorId,
          styleAssetId: styled.styleSeedAssetId,
          sourceAssetId: orphan,
        } : { origin: "generation", subject: "Песков" },
      });
      assertOk(finished, `finish-${frameId}`);
    }
    assertOk(await store.updatePlacement({
      frameId: "f1",
      panelIndex: 0,
      zoom: 1.5,
      positionX: 20,
      positionY: 40,
      mirrored: true,
    }), "placement");
    assertOk(await store.approveVisual(), "approve");
    const pendingAnchor = await store.beginAnchor({ characterName: "Путин", instruction: "ещё вариант" });
    assertOk(pendingAnchor, "pending-anchor");
    const research = createResearchStore(pool);
    assertOk(await research.appendNote({
      projectId: sourceId,
      submittedText: "заметка-017",
      context: researchContext(),
    }), "note");
    const pendingReading = await beginReading(pool);
    assertOk(pendingReading, "pending-reading");

    const sourceBefore = await pool.query(
      `SELECT title, updated_at, last_opened_at, active_source_revision_id, active_material_state_id, current_reading_id
       FROM project WHERE id = $1`,
      [sourceId],
    );
    const draftBefore = await pool.query(
      `SELECT text, revision_token FROM working_draft WHERE project_id = $1`,
      [sourceId],
    );
    const sourceVisualBefore = await store.load();
    const sourceProjectBefore = await loadProject(pool);
    const copied = await duplicateProject(pool, sourceId, "Копия — Проверка");
    assertOk(copied, "duplicate");
    assert.equal(copied.project.title, "Копия — Проверка");
    assert.equal(copied.project.lastOpenedAt, null);
    assert.notEqual(copied.project.stage, "Готовое видео");
    const copyId = copied.project.id;
    created.push(copyId);

    const sourceAfter = await pool.query(
      `SELECT title, updated_at, last_opened_at, active_source_revision_id, active_material_state_id, current_reading_id
       FROM project WHERE id = $1`,
      [sourceId],
    );
    const draftAfter = await pool.query(
      `SELECT text, revision_token FROM working_draft WHERE project_id = $1`,
      [sourceId],
    );
    assert.deepEqual(sourceAfter.rows[0], sourceBefore.rows[0]);
    assert.deepEqual(draftAfter.rows[0], draftBefore.rows[0]);

    enterProject(copyId);
    const copyProject = await loadProject(pool);
    const copyStore = createVisualStore(pool);
    const copyVisual = await copyStore.load();
    assert.equal(copyProject.id, copyId);
    assert.equal(copyProject.title, "Копия — Проверка");
    assert.equal(copyProject.draft.text, sourceProjectBefore.draft.text);
    assert.notEqual(copyProject.draft.revisionToken, sourceProjectBefore.draft.revisionToken);
    assert.equal(copyProject.reading, null);
    assert.equal(copyProject.sourceRevisions.length, 1);
    assert.equal(copyProject.sourceRevisions[0].parentSourceRevisionId, null);
    assert.deepEqual(materialShape(copyProject), materialShape(sourceProjectBefore));
    assert.equal(JSON.stringify(copyProject).includes("СТАРАЯ-РАСКАДРОВКА"), false);
    assert.deepEqual(visualShape(copyVisual), visualShape(sourceVisualBefore));
    assert.equal(copyVisual.canUndo, false);
    assert.equal(sourceVisualBefore.canUndo, true);
    assert.equal(copyVisual.approved, true);

    const exclusions = await pool.query(
      `SELECT extracted_name FROM character_exclusion WHERE project_id = $1 ORDER BY extracted_name`,
      [copyId],
    );
    assert.deepEqual(exclusions.rows.map((row) => row.extracted_name), ["Лишний"]);
    const readings = await pool.query(
      `SELECT status, failure_kind, current_reading_id IS NOT NULL AS current
       FROM reading
       LEFT JOIN project ON project.current_reading_id = reading.id
       WHERE reading.project_id = $1`,
      [copyId],
    );
    assert.equal(readings.rowCount, 1);
    assert.equal(readings.rows[0].status, "ready");
    assert.equal(readings.rows[0].failure_kind, null);
    assert.equal(readings.rows[0].current, false);
    const pendingCast = await pool.query(
      `SELECT count(*)::int AS count FROM pending_character
       WHERE reading_id IN (SELECT id FROM reading WHERE project_id = $1)`,
      [copyId],
    );
    assert.equal(pendingCast.rows[0].count, 0);
    const versions = await pool.query(
      `SELECT storyboard_version.parent_storyboard_version_id, storyboard_version.instruction, storyboard_version.operation_context
       FROM storyboard_version
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.equal(versions.rowCount, 1);
    assert.equal(versions.rows[0].parent_storyboard_version_id, null);
    assert.equal(versions.rows[0].instruction, null);
    assert.equal(versions.rows[0].operation_context, null);
    const generations = await pool.query(
      `SELECT count(*)::int AS count
       FROM panel_generation
       JOIN panel_visual_state ON panel_visual_state.id = panel_generation.panel_visual_state_id
       JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.equal(generations.rows[0].count, 0);
    await assertCopiedAnchorBoundary(pool, copyId);
    const notes = await research.listTrace({ projectId: copyId, kind: "note" });
    assert.equal(notes.events.length, 0);
    const sourceNotes = await research.listTrace({ projectId: sourceId, kind: "note" });
    assert.equal(sourceNotes.events.some((event) => event.submittedText === "заметка-017"), true);

    const sourceAssets = await assetIds(pool, sourceId);
    const copyAssets = await assetIds(pool, copyId);
    const sourceAssetIds = new Set(sourceAssets.map((row) => row.id));
    assert.equal(copyAssets.length > 0, true);
    assert.equal(copyAssets.some((row) => sourceAssetIds.has(row.id)), false);
    assert.equal(copyAssets.some((row) => row.id === orphan), false);
    const sourceHashes = new Set(sourceAssets.map((row) => row.sha256));
    assert.equal(copyAssets.every((row) => sourceHashes.has(row.sha256)), true);
    const provenance = await pool.query(
      `SELECT provenance FROM visual_asset
       WHERE project_id = $1 AND provenance->>'storyboardResultId' IS NOT NULL`,
      [copyId],
    );
    assert.equal(provenance.rowCount, 1);
    assert.equal(sourceAssetIds.has(provenance.rows[0].provenance.storyboardResultId), false);
    assert.equal(sourceAssetIds.has(provenance.rows[0].provenance.anchorVersionId), false);
    assert.equal(sourceAssetIds.has(provenance.rows[0].provenance.styleAssetId), false);
    assert.equal(provenance.rows[0].provenance.sourceAssetId, undefined);
    enterProject(copyId);
    assert.equal(await readAsset(pool, orphan), null);
    enterProject(sourceId);
    assert.equal(await readAsset(pool, copyAssets[0].id), null);
    enterProject(copyId);
    const owned = await readAsset(pool, copyAssets[0].id);
    assert.equal(owned?.sha256, copyAssets[0].sha256);

    const compiled = compileVideoSpec(copyVisual, {
      assetOrigin: `http://127.0.0.1:9/api/projects/${copyId}`,
    });
    assert.equal(compiled.ok, true, compiled.kind);
    const compiledAssetIds = compiled.spec.frames.flatMap((frame) => frame.panels.map((panel) => panel.assetId).filter(Boolean));
    assert.equal(compiledAssetIds.length > 0, true);
    for (const assetId of compiledAssetIds) {
      assert.equal(sourceAssetIds.has(assetId), false);
      const panel = compiled.spec.frames.flatMap((frame) => frame.panels).find((item) => item.assetId === assetId);
      assert.match(panel.asset, new RegExp(`/api/projects/${copyId}/visual/assets/${assetId}$`));
    }
    const controller = createRenderController({
      outputDir: renderDir,
      runRender: async (_spec, file) => writeFile(file, Buffer.from("source-mp4")),
    });
    enterProject(sourceId);
    const sourceCompiled = compileVideoSpec(sourceVisualBefore, {
      assetOrigin: `http://127.0.0.1:9/api/projects/${sourceId}`,
    });
    assert.equal(sourceCompiled.ok, true, sourceCompiled.kind);
    assert.equal(controller.start(sourceCompiled.spec, {}, sourceId).ok, true);
    let sourceRender = "running";
    for (let attempt = 0; attempt < 50 && sourceRender === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sourceRender = controller.status(sourceId).status;
    }
    assert.equal(sourceRender, "success");
    assert.equal(controller.status(copyId).status, "idle");
    assert.equal(controller.resultFile(copyId), null);
    assert.equal(controller.readyProjectIds().includes(copyId), false);
    assert.equal(controller.readyProjectIds().includes(sourceId), true);

    const again = await duplicateProject(pool, sourceId, "Вторая копия");
    assertOk(again, "second");
    assert.notEqual(again.project.id, copyId);
    created.push(again.project.id);

    const sourcePanel = sourceVisualBefore.frames.find((frame) => frame.id === "f2").panels[0].assetId;
    const copyPanel = copyVisual.frames.find((frame) => frame.id === "f2").panels[0].assetId;
    const copyDuration = copyVisual.frames.find((frame) => frame.id === "f-silent").durationFrames;
    enterProject(sourceId);
    assertOk(await saveDraft(pool, { text: "Черновик только источника", revisionToken: draftAfter.rows[0].revision_token }), "mutate-draft");
    assertOk(await store.applyOperation({
      op: "setDuration",
      structureFrameId: "f-silent",
      durationFrames: 90,
    }), "mutate-duration");
    assertOk(await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      targets: [{ panelId: "p2" }],
    }), "mutate-asset");
    const sourceEdited = await reviseSourceUtterance(pool, {
      sourceItemId: "u1",
      spokenText: editedSpoken,
      materialStateId: sourceAfter.rows[0].active_material_state_id,
      storyboardVersionId: (await store.load()).storyboardVersionId,
    });
    assertOk(sourceEdited, "mutate-source");
    enterProject(copyId);
    assertOk(await copyStore.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "f1",
      dialogueMode: "hidden",
    }), "mutate-dialogue");
    assertOk(await copyStore.updatePlacement({
      frameId: "f2",
      panelIndex: 0,
      zoom: 2,
      positionX: 10,
      positionY: 10,
      mirrored: false,
    }), "mutate-placement");

    const copyAfter = await loadProject(pool);
    const copyVisualAfter = await copyStore.load();
    enterProject(sourceId);
    const sourceProjectAfter = await loadProject(pool);
    const sourceVisualAfter = await store.load();
    assert.equal(copyAfter.draft.text, draft);
    assert.equal(sourceProjectAfter.draft.text.includes(editedSpoken), true);
    assert.equal(copyAfter.material.sourceItems[0].text, spoken);
    assert.equal(sourceProjectAfter.material.sourceItems[0].text, editedSpoken);
    assert.equal(sourceVisualAfter.frames.find((frame) => frame.id === "f1").dialogueMode, "spoken");
    assert.equal(copyVisualAfter.frames.find((frame) => frame.id === "f1").dialogueMode, "hidden");
    assert.equal(copyVisualAfter.frames.find((frame) => frame.id === "f-silent").durationFrames, copyDuration);
    assert.equal(sourceVisualAfter.frames.find((frame) => frame.id === "f-silent").durationFrames, 90);
    assert.equal(sourceVisualAfter.frames.find((frame) => frame.id === "f2").panels[0].zoom, 1);
    assert.equal(copyVisualAfter.frames.find((frame) => frame.id === "f2").panels[0].zoom, 2);
    assert.notEqual(sourceVisualAfter.frames.find((frame) => frame.id === "f2").panels[0].assetId, sourcePanel);
    assert.equal(copyVisualAfter.frames.find((frame) => frame.id === "f2").panels[0].assetId, copyPanel);

    enterProject(copyId);
    const aliased = {
      ...cast(),
      aliases: [...cast().aliases, { surface: "сказал", characterName: "Путин" }],
    };
    assertOk(await reviseMaterialState(pool, aliased), "mutate-cast");
    const copyCast = await loadProject(pool);
    enterProject(sourceId);
    const sourceCast = await loadProject(pool);
    assert.equal(sourceCast.material.cast.aliases.some((alias) => alias.surface === "сказал"), false);
    assert.equal(copyCast.material.cast.aliases.some((alias) => alias.surface === "сказал"), true);
    assert.equal(sourceCast.material.cast.characters.every((character) => character.included), true);

    const beforeFailure = await pool.query(`SELECT count(*)::int AS count FROM project`);
    const beforeAssets = await pool.query(`SELECT count(*)::int AS count FROM visual_asset`);
    const failed = await duplicateProject(pool, sourceId, "Копия отката", {
      afterCopy: async () => {
        throw new Error("induced-failure");
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, "database");
    const afterFailure = await pool.query(`SELECT count(*)::int AS count FROM project`);
    const afterAssets = await pool.query(`SELECT count(*)::int AS count FROM visual_asset`);
    assert.equal(afterFailure.rows[0].count, beforeFailure.rows[0].count);
    assert.equal(afterAssets.rows[0].count, beforeAssets.rows[0].count);
    const titled = await pool.query(`SELECT count(*)::int AS count FROM project WHERE title = 'Копия отката'`);
    assert.equal(titled.rows[0].count, 0);

    const survivorAssets = await assetIds(pool, copyId);
    await purgeProject(guard, sourceId);
    created.splice(created.indexOf(sourceId), 1);
    enterProject(copyId);
    const survived = await loadProject(pool);
    assert.equal(survived.title, "Копия — Проверка");
    assert.equal(survived.material.sourceItems[0].text, spoken);
    const stillOwned = await readAsset(pool, survivorAssets[0].id);
    assert.equal(stillOwned?.id, survivorAssets[0].id);
    await purgeProject(guard, again.project.id);
    created.splice(created.indexOf(again.project.id), 1);
    const stillThere = await loadProject(pool);
    assert.equal(stillThere.id, copyId);
    await purgeProject(guard, copyId);
    created.splice(created.indexOf(copyId), 1);
    const gone = await pool.query(`SELECT count(*)::int AS count FROM project WHERE id = $1`, [copyId]);
    assert.equal(gone.rows[0].count, 0);
  } finally {
    for (const projectId of created) {
      await purgeProject(guard, projectId).catch(async () => {
        await guard.query("ROLLBACK").catch(() => {});
      });
    }
    await rm(renderDir, { recursive: true, force: true }).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

async function assertCopiedAnchorBoundary(pool, projectId) {
  const anchors = await pool.query(
    `SELECT character_anchor_version.id,
            character_anchor_version.status,
            character_anchor_version.parent_anchor_version_id,
            character_anchor_version.provider_metadata
     FROM character_anchor_version
     JOIN material_state ON material_state.id = character_anchor_version.material_state_id
     JOIN source_revision ON source_revision.id = material_state.source_revision_id
     WHERE source_revision.project_id = $1`,
    [projectId],
  );
  const heads = await pool.query(
    `SELECT character_anchor_head.anchor_version_id
     FROM character_anchor_head
     JOIN material_state ON material_state.id = character_anchor_head.material_state_id
     JOIN source_revision ON source_revision.id = material_state.source_revision_id
     WHERE source_revision.project_id = $1
       AND character_anchor_head.anchor_version_id IS NOT NULL`,
    [projectId],
  );
  const seed = await pool.query(
    `SELECT project_style_seed.source_anchor_version_id
     FROM project_style_seed
     JOIN material_state ON material_state.id = project_style_seed.material_state_id
     JOIN source_revision ON source_revision.id = material_state.source_revision_id
     WHERE source_revision.project_id = $1`,
    [projectId],
  );
  const headIds = new Set(heads.rows.map((row) => row.anchor_version_id));
  const seedAnchorId = seed.rows[0]?.source_anchor_version_id ?? null;
  const allowed = new Set(headIds);
  if (seedAnchorId) allowed.add(seedAnchorId);
  const extras = anchors.rows.map((row) => row.id).filter((id) => !headIds.has(id));
  assert.equal(extras.length <= 1, true);
  assert.equal(anchors.rowCount, allowed.size);
  if (seedAnchorId && !headIds.has(seedAnchorId)) assert.deepEqual(extras, [seedAnchorId]);
  assert.equal(anchors.rows.every((row) => (
    allowed.has(row.id)
    && row.status === "approved"
    && row.parent_anchor_version_id == null
    && row.provider_metadata == null
  )), true);
}

test("duplication keeps the exact older anchor that established the style seed", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 60000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const created = [];
  const sourceText = "Анна: Привет";
  const spoken = "Привет";
  const seedBytes = Buffer.concat([png, Buffer.from([1])]);
  const headBytes = Buffer.concat([png, Buffer.from([2])]);
  const otherBytes = Buffer.concat([png, Buffer.from([3])]);
  const identityBytes = Buffer.concat([png, Buffer.from([4])]);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const project = await createProject(pool);
    assertOk(project, "create-seed-source");
    const sourceId = project.project.id;
    created.push(sourceId);
    enterProject(sourceId);
    const empty = await loadProject(pool);
    assertOk(await saveDraft(pool, { text: sourceText, revisionToken: empty.draft.revisionToken }), "seed-draft");

    const revisionId = randomUUID();
    const readingId = randomUUID();
    const interpretationId = randomUUID();
    const materialId = randomUUID();
    const annaId = randomUUID();
    const borisId = randomUUID();
    const retiredId = randomUUID();
    const oldAnchorId = randomUUID();
    const newAnchorId = randomUUID();
    const otherAnchorId = randomUUID();
    const pendingId = randomUUID();
    const resultId = randomUUID();
    const versionId = randomUUID();
    const frames = [{
      id: "f-seed",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: spoken,
      durationFrames: 180,
      displayBlock: { sourceItemId: "u1", start: 0, end: spoken.length },
      panels: [{ id: "p-seed", description: "Анна" }],
    }];
    async function insertAsset(bytes) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes)
         VALUES ($1, $2, 'base-anchor', 'image/png', 1, 1, $3, $4, $5)`,
        [id, sourceId, bytes.length, sha(bytes), bytes],
      );
      return id;
    }
    const seedAssetId = await insertAsset(seedBytes);
    const headAssetId = await insertAsset(headBytes);
    const otherAssetId = await insertAsset(otherBytes);
    const identityAssetId = await insertAsset(identityBytes);
    await pool.query(
      `INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, $3)`,
      [revisionId, sourceId, sourceText],
    );
    await pool.query(
      `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, $3, $4, 'ready')`,
      [readingId, sourceId, sourceText, randomUUID()],
    );
    await pool.query(
      `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
      [interpretationId, revisionId, readingId],
    );
    await pool.query(
      `INSERT INTO source_item (
         interpretation_id, ordinal, model_id, kind, speaker_status, speaker_label,
         draft_start, draft_end, source_quote, spoken_text
       ) VALUES ($1, 0, 'u1', 'utterance', 'explicit', 'Анна', 0, $2, $3, $4)`,
      [interpretationId, sourceText.length, sourceText, spoken],
    );
    await pool.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)`,
      [materialId, revisionId, interpretationId],
    );
    await pool.query(
      `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included, extracted_name)
       VALUES ($1, $2, 0, 'Анна', true, 'Анна'), ($3, $2, 1, 'Борис', true, 'Борис')`,
      [annaId, materialId, borisId],
    );
    await pool.query(
      `INSERT INTO speaker_assignment (material_state_id, source_item_model_id, character_id)
       VALUES ($1, 'u1', $2)`,
      [materialId, annaId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, instruction, status, provider_metadata
       ) VALUES ($1, $2, 'Анна', 'retired-history', 'retired', '{"hidden":true}'::jsonb)`,
      [retiredId, materialId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, parent_anchor_version_id,
         identity_asset_id, output_asset_id, style_asset_id, instruction, status,
         provenance, provider_metadata, approved_at
       ) VALUES (
         $1, $2, 'Анна', $3, $4, $5, $5, 'первый стиль', 'approved',
         'generated_from_source', '{"provider":"secret"}'::jsonb, clock_timestamp()
       )`,
      [oldAnchorId, materialId, retiredId, identityAssetId, seedAssetId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, parent_anchor_version_id,
         output_asset_id, instruction, status, provenance, approved_at
       ) VALUES (
         $1, $2, 'Анна', $3, $4, 'новый якорь', 'approved',
         'refined_from_accepted_anchor', clock_timestamp()
       )`,
      [newAnchorId, materialId, oldAnchorId, headAssetId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, output_asset_id, instruction, status, provenance, approved_at
       ) VALUES ($1, $2, 'Борис', $3, 'другой персонаж', 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
      [otherAnchorId, materialId, otherAssetId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, instruction, status, provider_metadata
       ) VALUES ($1, $2, 'Анна', 'не копировать', 'pending', '{"hidden":true}'::jsonb)`,
      [pendingId, materialId],
    );
    await pool.query(
      `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
       VALUES ($1, 'Анна', $2), ($1, 'Борис', $3)`,
      [materialId, newAnchorId, otherAnchorId],
    );
    await pool.query(
      `INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
       VALUES ($1, $2, $3)`,
      [materialId, seedAssetId, oldAnchorId],
    );
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb)`,
      [resultId, materialId, JSON.stringify({ frames })],
    );
    await pool.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
      [versionId, resultId, JSON.stringify(frames)],
    );
    await pool.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [resultId, versionId],
    );
    await pool.query(
      `INSERT INTO panel_visual_state (
         id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
         current_asset_id, current_asset_origin
       ) VALUES ($1, $2, 'f-seed', 0, 'p-seed', 'Анна', $3, 'generation')`,
      [randomUUID(), versionId, headAssetId],
    );
    await pool.query(
      `UPDATE project
       SET active_source_revision_id = $2, active_material_state_id = $3, current_reading_id = NULL
       WHERE id = $1`,
      [sourceId, revisionId, materialId],
    );

    const copied = await duplicateProject(pool, sourceId, "Копия стиля");
    assertOk(copied, "duplicate-style-seed");
    const copyId = copied.project.id;
    created.push(copyId);

    const heads = await pool.query(
      `SELECT character_anchor_head.character_name,
              character_anchor_head.anchor_version_id,
              character_anchor_version.instruction,
              character_anchor_version.output_asset_id
       FROM character_anchor_head
       JOIN character_anchor_version ON character_anchor_version.id = character_anchor_head.anchor_version_id
       JOIN material_state ON material_state.id = character_anchor_head.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    const seed = await pool.query(
      `SELECT project_style_seed.source_anchor_version_id, project_style_seed.style_asset_id
       FROM project_style_seed
       JOIN material_state ON material_state.id = project_style_seed.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.equal(seed.rowCount, 1);
    const annaHead = heads.rows.find((row) => row.character_name === "Анна");
    const borisHead = heads.rows.find((row) => row.character_name === "Борис");
    assert.equal(annaHead.instruction, "новый якорь");
    assert.equal(borisHead.instruction, "другой персонаж");
    assert.notEqual(seed.rows[0].source_anchor_version_id, annaHead.anchor_version_id);
    assert.notEqual(seed.rows[0].source_anchor_version_id, borisHead.anchor_version_id);
    const seedAnchor = await pool.query(
      `SELECT id, character_name, instruction, provenance, status, parent_anchor_version_id,
              provider_metadata, error_kind, identity_asset_id, output_asset_id, style_asset_id
       FROM character_anchor_version
       WHERE id = $1`,
      [seed.rows[0].source_anchor_version_id],
    );
    assert.equal(seedAnchor.rowCount, 1);
    assert.equal(seedAnchor.rows[0].character_name, "Анна");
    assert.equal(seedAnchor.rows[0].instruction, "первый стиль");
    assert.equal(seedAnchor.rows[0].provenance, "generated_from_source");
    assert.equal(seedAnchor.rows[0].status, "approved");
    assert.equal(seedAnchor.rows[0].parent_anchor_version_id, null);
    assert.equal(seedAnchor.rows[0].provider_metadata, null);
    assert.equal(seedAnchor.rows[0].error_kind, null);
    assert.equal(heads.rows.some((row) => row.anchor_version_id === seedAnchor.rows[0].id), false);
    const copiedAnchors = await pool.query(
      `SELECT instruction
       FROM character_anchor_version
       JOIN material_state ON material_state.id = character_anchor_version.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.deepEqual(copiedAnchors.rows.map((row) => row.instruction).sort(), [
      "другой персонаж",
      "новый якорь",
      "первый стиль",
    ]);
    await assertCopiedAnchorBoundary(pool, copyId);

    async function ownedAsset(assetId) {
      const row = await pool.query(
        `SELECT id, project_id, sha256, mime, width, height, byte_length FROM visual_asset WHERE id = $1`,
        [assetId],
      );
      assert.equal(row.rowCount, 1);
      assert.equal(row.rows[0].project_id, copyId);
      assert.equal([seedAssetId, headAssetId, otherAssetId, identityAssetId].includes(row.rows[0].id), false);
      return row.rows[0];
    }
    const copiedSeedAsset = await ownedAsset(seed.rows[0].style_asset_id);
    assert.equal(copiedSeedAsset.sha256, sha(seedBytes));
    assert.equal(copiedSeedAsset.mime, "image/png");
    assert.equal(copiedSeedAsset.byte_length, seedBytes.length);
    const copiedHeadAsset = await ownedAsset(annaHead.output_asset_id);
    assert.equal(copiedHeadAsset.sha256, sha(headBytes));
    const copiedIdentity = await ownedAsset(seedAnchor.rows[0].identity_asset_id);
    assert.equal(copiedIdentity.sha256, sha(identityBytes));
    const copiedSeedOutput = await ownedAsset(seedAnchor.rows[0].output_asset_id);
    assert.equal(copiedSeedOutput.sha256, sha(seedBytes));
    assert.equal(copiedSeedOutput.id, copiedSeedAsset.id);

    const sourceIdentities = [
      sourceId, revisionId, readingId, interpretationId, materialId,
      retiredId, oldAnchorId, newAnchorId, otherAnchorId, pendingId,
      seedAssetId, headAssetId, otherAssetId, identityAssetId, resultId, versionId,
    ];
    const destinationRefs = await pool.query(
      `SELECT character_anchor_version.id::text,
              character_anchor_version.identity_asset_id::text,
              character_anchor_version.output_asset_id::text,
              character_anchor_version.style_asset_id::text,
              character_anchor_version.parent_anchor_version_id::text,
              visual_asset.provenance::text
       FROM character_anchor_version
       JOIN material_state ON material_state.id = character_anchor_version.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       LEFT JOIN visual_asset ON visual_asset.project_id = source_revision.project_id
         AND visual_asset.id IN (
           character_anchor_version.identity_asset_id,
           character_anchor_version.output_asset_id,
           character_anchor_version.style_asset_id
         )
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    const serialized = JSON.stringify(destinationRefs.rows) + seed.rows[0].source_anchor_version_id + seed.rows[0].style_asset_id;
    assert.equal(sourceIdentities.some((id) => serialized.includes(id)), false);

    enterProject(copyId);
    const visual = await createVisualStore(pool).load();
    assert.equal(visual.status, "ready");
    assert.equal(visual.characters.find((character) => character.name === "Анна").approvedAnchorId, annaHead.anchor_version_id);
    const compiled = compileVideoSpec(visual, {
      assetOrigin: `http://127.0.0.1:9/api/projects/${copyId}`,
    });
    assert.equal(compiled.ok, true, compiled.kind);
    await purgeProject(guard, sourceId);
    created.splice(created.indexOf(sourceId), 1);
    enterProject(copyId);
    const survived = await createVisualStore(pool).load();
    assert.equal(survived.status, "ready");
    assert.equal((await readAsset(pool, seed.rows[0].style_asset_id))?.sha256, sha(seedBytes));
    await purgeProject(guard, copyId);
    created.splice(created.indexOf(copyId), 1);
  } finally {
    for (const projectId of created) {
      await purgeProject(guard, projectId).catch(async () => {
        await guard.query("ROLLBACK").catch(() => {});
      });
    }
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("duplication accepts a style seed whose approved anchor belongs to an earlier material", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const created = [];
  const line = "Анна: Привет";
  const spoken = "Привет";
  const edited = "Привет!";
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const project = await createProject(pool);
    assertOk(project, "cross-create");
    const sourceId = project.project.id;
    created.push(sourceId);
    enterProject(sourceId);
    const empty = await loadProject(pool);
    assertOk(await saveDraft(pool, { text: line, revisionToken: empty.draft.revisionToken }), "cross-draft");
    const started = await beginReading(pool);
    assertOk(started, "cross-reading");
    assertOk(await finishReading(pool, {
      readingId: started.readingId,
      sourceItems: [{
        id: "u1",
        kind: "utterance",
        segmentIds: ["seg-0"],
        speakerStatus: "explicit",
        speakerLabel: "Анна",
        sourceQuote: line,
        draftStart: 0,
        draftEnd: line.length,
        text: spoken,
      }],
      characters: [
        { id: "anna", name: "Анна" },
        { id: "boris", name: "Борис" },
      ],
      surfaceForms: [
        { id: "label", quote: "Анна", role: "speaker-label", characterId: "anna" },
      ],
    }), "cross-finish");
    assertOk(await replacePendingCast(pool, started.readingId, {
      characters: [
        { name: "Анна", extractedName: "Анна", included: true },
        { name: "Борис", extractedName: "Борис", included: true },
      ],
      aliases: [{ surface: "Анна", characterName: "Анна" }],
      speakers: [{ sourceItemId: "u1", characterName: "Анна" }],
    }), "cross-cast");
    const confirmed = await confirmReading(pool, { readingId: started.readingId });
    assertOk(confirmed, "cross-confirm");
    const frames = [{
      id: "f1",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: spoken,
      durationFrames: 180,
      displayBlock: { sourceItemId: "u1", start: 0, end: spoken.length },
      panels: [{ id: "p1", description: "Анна" }],
    }];
    const resultId = randomUUID();
    const versionId = randomUUID();
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb)`,
      [resultId, confirmed.materialStateId, JSON.stringify({ frames })],
    );
    await pool.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
      [versionId, resultId, JSON.stringify(frames)],
    );
    await pool.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [resultId, versionId],
    );
    const store = createVisualStore(pool);
    const anna = await store.acceptSessionAnchor({
      characterName: "Анна",
      provenance: "generated_from_source",
      image: { bytes: png },
      sourceImage: { bytes: png },
      instruction: "контур",
    });
    assertOk(anna, "cross-anna");
    const boris = await store.acceptSessionAnchor({
      characterName: "Борис",
      provenance: "uploaded_as_ready_anchor",
      image: { bytes: png },
      instruction: "борис",
    });
    assertOk(boris, "cross-boris");
    const originalSeed = await pool.query(
      `SELECT source_anchor_version_id, style_asset_id
       FROM project_style_seed WHERE material_state_id = $1`,
      [confirmed.materialStateId],
    );
    assert.equal(originalSeed.rows[0].source_anchor_version_id, anna.anchorId);
    const editedSource = await reviseSourceUtterance(pool, {
      sourceItemId: "u1",
      spokenText: edited,
      materialStateId: confirmed.materialStateId,
      storyboardVersionId: versionId,
    });
    assertOk(editedSource, "cross-later-material");
    assert.notEqual(editedSource.materialStateId, confirmed.materialStateId);
    const carriedSeed = await pool.query(
      `SELECT source_anchor_version_id FROM project_style_seed WHERE material_state_id = $1`,
      [editedSource.materialStateId],
    );
    assert.equal(carriedSeed.rows[0].source_anchor_version_id, anna.anchorId);
    const laterHead = await pool.query(
      `SELECT anchor_version_id FROM character_anchor_head
       WHERE material_state_id = $1 AND character_name = 'Анна'`,
      [editedSource.materialStateId],
    );
    assert.notEqual(laterHead.rows[0].anchor_version_id, anna.anchorId);
    await pool.query(
      `UPDATE character_anchor_version SET instruction = 'исходный стиль' WHERE id = $1`,
      [anna.anchorId],
    );

    const copied = await duplicateProject(pool, sourceId, "Копия через материал");
    assertOk(copied, "cross-duplicate");
    const copyId = copied.project.id;
    created.push(copyId);
    const destSeed = await pool.query(
      `SELECT project_style_seed.source_anchor_version_id,
              project_style_seed.style_asset_id,
              project_style_seed.material_state_id AS seed_material_state_id,
              character_anchor_version.instruction,
              character_anchor_version.material_state_id AS anchor_material_state_id,
              anchor_revision.project_id AS anchor_project_id,
              project.active_material_state_id
       FROM project_style_seed
       JOIN character_anchor_version
         ON character_anchor_version.id = project_style_seed.source_anchor_version_id
       JOIN material_state AS anchor_material
         ON anchor_material.id = character_anchor_version.material_state_id
       JOIN source_revision AS anchor_revision
         ON anchor_revision.id = anchor_material.source_revision_id
       JOIN material_state AS seed_material
         ON seed_material.id = project_style_seed.material_state_id
       JOIN source_revision AS seed_revision
         ON seed_revision.id = seed_material.source_revision_id
       JOIN project ON project.id = seed_revision.project_id
       WHERE project.id = $1`,
      [copyId],
    );
    assert.equal(destSeed.rowCount, 1);
    assert.equal(destSeed.rows[0].instruction, "исходный стиль");
    assert.equal(destSeed.rows[0].anchor_project_id, copyId);
    assert.equal(destSeed.rows[0].anchor_material_state_id, destSeed.rows[0].seed_material_state_id);
    assert.equal(destSeed.rows[0].anchor_material_state_id, destSeed.rows[0].active_material_state_id);
    assert.notEqual(destSeed.rows[0].anchor_material_state_id, confirmed.materialStateId);
    assert.notEqual(destSeed.rows[0].anchor_material_state_id, editedSource.materialStateId);
    const destHeads = await pool.query(
      `SELECT character_name, anchor_version_id
       FROM character_anchor_head
       JOIN material_state ON material_state.id = character_anchor_head.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    const annaHead = destHeads.rows.find((row) => row.character_name === "Анна");
    const borisHead = destHeads.rows.find((row) => row.character_name === "Борис");
    assert.notEqual(destSeed.rows[0].source_anchor_version_id, annaHead.anchor_version_id);
    assert.notEqual(destSeed.rows[0].source_anchor_version_id, borisHead.anchor_version_id);
    assert.equal(destHeads.rows.some((row) => row.anchor_version_id === destSeed.rows[0].source_anchor_version_id), false);
    const headInstruction = await pool.query(
      `SELECT instruction FROM character_anchor_version WHERE id = $1`,
      [annaHead.anchor_version_id],
    );
    assert.equal(headInstruction.rows[0].instruction, "контур");
    const styleAsset = await pool.query(
      `SELECT project_id FROM visual_asset WHERE id = $1`,
      [destSeed.rows[0].style_asset_id],
    );
    assert.equal(styleAsset.rows[0].project_id, copyId);
    assert.notEqual(destSeed.rows[0].style_asset_id, originalSeed.rows[0].style_asset_id);
    assert.notEqual(destSeed.rows[0].source_anchor_version_id, anna.anchorId);

    const foreign = await createProject(pool);
    assertOk(foreign, "foreign-create");
    created.push(foreign.project.id);
    const foreignAnchorId = randomUUID();
    const foreignMaterialId = randomUUID();
    const foreignRevisionId = randomUUID();
    const foreignReadingId = randomUUID();
    const foreignInterpretationId = randomUUID();
    await pool.query(`INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'чужой')`, [foreignRevisionId, foreign.project.id]);
    await pool.query(
      `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, 'чужой', $3, 'ready')`,
      [foreignReadingId, foreign.project.id, randomUUID()],
    );
    await pool.query(
      `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
      [foreignInterpretationId, foreignRevisionId, foreignReadingId],
    );
    await pool.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)`,
      [foreignMaterialId, foreignRevisionId, foreignInterpretationId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, instruction, status, provenance, approved_at
       ) VALUES ($1, $2, 'Анна', 'чужой якорь', 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
      [foreignAnchorId, foreignMaterialId],
    );
    await pool.query(
      `UPDATE project_style_seed SET source_anchor_version_id = $2 WHERE material_state_id = $1`,
      [editedSource.materialStateId, foreignAnchorId],
    );
    const before = await pool.query(`SELECT count(*)::int AS count FROM project`);
    const rejected = await duplicateProject(pool, sourceId, "Чужая копия");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.kind, "database");
    const after = await pool.query(`SELECT count(*)::int AS count FROM project`);
    assert.equal(after.rows[0].count, before.rows[0].count);
    const titled = await pool.query(`SELECT count(*)::int AS count FROM project WHERE title = 'Чужая копия'`);
    assert.equal(titled.rows[0].count, 0);
  } finally {
    for (const projectId of created) {
      await purgeProject(guard, projectId).catch(async () => {
        await guard.query("ROLLBACK").catch(() => {});
      });
    }
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("duplication keeps picker-visible images and omits hidden orphan assets", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 60000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const created = [];
  const selectedBytes = Buffer.concat([png, Buffer.from([11])]);
  const reusableBytes = Buffer.concat([png, Buffer.from([12])]);
  const orphanBytes = Buffer.concat([png, Buffer.from([13])]);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const project = await createProject(pool);
    assertOk(project, "reuse-create");
    const sourceId = project.project.id;
    created.push(sourceId);
    enterProject(sourceId);
    const empty = await loadProject(pool);
    assertOk(await saveDraft(pool, { text: "Анна: Привет", revisionToken: empty.draft.revisionToken }), "reuse-draft");
    const revisionId = randomUUID();
    const readingId = randomUUID();
    const interpretationId = randomUUID();
    const materialId = randomUUID();
    const characterId = randomUUID();
    const anchorId = randomUUID();
    const resultId = randomUUID();
    const versionId = randomUUID();
    const stateId = randomUUID();
    const selectedId = randomUUID();
    const reusableId = randomUUID();
    const orphanId = randomUUID();
    const anchorAssetId = randomUUID();
    async function insertAsset(id, bytes, kind) {
      await pool.query(
        `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes)
         VALUES ($1, $2, $3, 'image/png', 1, 1, $4, $5, $6)`,
        [id, sourceId, kind, bytes.length, sha(bytes), bytes],
      );
    }
    await insertAsset(selectedId, selectedBytes, "panel-image");
    await insertAsset(reusableId, reusableBytes, "panel-image");
    await insertAsset(orphanId, orphanBytes, "panel-image");
    await insertAsset(anchorAssetId, png, "base-anchor");
    await pool.query(`INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'Анна: Привет')`, [revisionId, sourceId]);
    await pool.query(
      `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, 'Анна: Привет', $3, 'ready')`,
      [readingId, sourceId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
      [interpretationId, revisionId, readingId],
    );
    await pool.query(
      `INSERT INTO source_item (
         interpretation_id, ordinal, model_id, kind, speaker_status, speaker_label,
         draft_start, draft_end, source_quote, spoken_text
       ) VALUES ($1, 0, 'u1', 'utterance', 'explicit', 'Анна', 0, 12, 'Анна: Привет', 'Привет')`,
      [interpretationId],
    );
    await pool.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)`,
      [materialId, revisionId, interpretationId],
    );
    await pool.query(
      `INSERT INTO canonical_character (id, material_state_id, ordinal, name) VALUES ($1, $2, 0, 'Анна')`,
      [characterId, materialId],
    );
    const frames = [{
      id: "f-reuse",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: "Привет",
      durationFrames: 180,
      panels: [{ id: "p-reuse", description: "Анна" }],
    }];
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb)`,
      [resultId, materialId, JSON.stringify({ frames })],
    );
    await pool.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
      [versionId, resultId, JSON.stringify(frames)],
    );
    await pool.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [resultId, versionId],
    );
    await pool.query(
      `INSERT INTO panel_visual_state (
         id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
         current_asset_id, current_asset_origin
       ) VALUES ($1, $2, 'f-reuse', 0, 'p-reuse', 'Анна', $3, 'generation')`,
      [stateId, versionId, selectedId],
    );
    await pool.query(
      `INSERT INTO panel_generation (
         id, panel_visual_state_id, output_asset_id, resolved_description, instruction, status
       ) VALUES ($1, $2, $3, 'запас', 'не выбрано', 'ready')`,
      [randomUUID(), stateId, reusableId],
    );
    await pool.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, output_asset_id, instruction, status, provenance, approved_at
       ) VALUES ($1, $2, 'Анна', $3, 'якорь', 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
      [anchorId, materialId, anchorAssetId],
    );
    await pool.query(
      `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
       VALUES ($1, 'Анна', $2)`,
      [materialId, anchorId],
    );
    await pool.query(
      `INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
       VALUES ($1, $2, $3)`,
      [materialId, anchorAssetId, anchorId],
    );
    await pool.query(
      `INSERT INTO visual_approval (id, storyboard_version_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [randomUUID(), versionId, JSON.stringify([{
        id: "f-reuse",
        panels: [{ assetId: selectedId, zoom: 1, position: "50% 30%", mirrored: false }],
      }])],
    );
    await pool.query(
      `UPDATE project SET active_source_revision_id = $2, active_material_state_id = $3, current_reading_id = NULL
       WHERE id = $1`,
      [sourceId, revisionId, materialId],
    );

    enterProject(sourceId);
    const sourceVisual = await createVisualStore(pool).load();
    assert.equal(sourceVisual.reusableAssets.some((asset) => asset.id === reusableId), true);
    assert.equal(sourceVisual.reusableAssets.some((asset) => asset.id === orphanId), false);
    const copied = await duplicateProject(pool, sourceId, "Копия ресурсов");
    assertOk(copied, "reuse-duplicate");
    const copyId = copied.project.id;
    created.push(copyId);

    const destAssets = await pool.query(
      `SELECT id, sha256, kind FROM visual_asset WHERE project_id = $1`,
      [copyId],
    );
    const bySha = new Map(destAssets.rows.map((row) => [row.sha256, row]));
    assert.equal(bySha.has(sha(selectedBytes)), true);
    assert.equal(bySha.has(sha(reusableBytes)), true);
    assert.equal(bySha.has(sha(orphanBytes)), false);
    assert.equal(bySha.has(sha(png)), true);
    assert.equal(destAssets.rows.some((row) => row.id === selectedId || row.id === reusableId || row.id === orphanId), false);
    const generations = await pool.query(
      `SELECT count(*)::int AS count
       FROM panel_generation
       JOIN panel_visual_state ON panel_visual_state.id = panel_generation.panel_visual_state_id
       JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.equal(generations.rows[0].count, 0);
    const versions = await pool.query(
      `SELECT count(*)::int AS count
       FROM storyboard_version
       JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1`,
      [copyId],
    );
    assert.equal(versions.rows[0].count, 1);

    enterProject(copyId);
    const copyStore = createVisualStore(pool);
    const copyVisual = await copyStore.load();
    assert.equal(copyVisual.status, "ready");
    assert.equal(copyVisual.approved, true);
    assert.equal(copyVisual.frames[0].panels[0].assetId, bySha.get(sha(selectedBytes)).id);
    const reusableChoice = copyVisual.reusableAssets.find((asset) => asset.id === bySha.get(sha(reusableBytes)).id);
    assert.equal(Boolean(reusableChoice), true);
    assert.equal(copyVisual.reusableAssets.some((asset) => asset.id === bySha.get(sha(orphanBytes))?.id), false);
    const sourceChoices = new Set(sourceVisual.reusableAssets.map((asset) => asset.id));
    const sourceShas = new Set((await pool.query(
      `SELECT sha256 FROM visual_asset WHERE id = ANY($1::uuid[])`,
      [[...sourceChoices]],
    )).rows.map((row) => row.sha256));
    const destShas = new Set((await pool.query(
      `SELECT sha256 FROM visual_asset WHERE id = ANY($1::uuid[])`,
      [copyVisual.reusableAssets.map((asset) => asset.id)],
    )).rows.map((row) => row.sha256));
    assert.deepEqual([...destShas].sort(), [...sourceShas].sort());

    const assigned = await copyStore.applyOperation({
      op: "assignAsset",
      assetId: reusableChoice.id,
      targets: [{ panelId: "p-reuse" }],
    });
    assertOk(assigned, "reuse-assign");
    const afterAssign = await copyStore.load();
    assert.equal(afterAssign.frames[0].panels[0].assetId, reusableChoice.id);
    enterProject(sourceId);
    const sourceAfter = await createVisualStore(pool).load();
    assert.equal(sourceAfter.frames[0].panels[0].assetId, selectedId);

    await purgeProject(guard, sourceId);
    created.splice(created.indexOf(sourceId), 1);
    enterProject(copyId);
    const survived = await createVisualStore(pool).load();
    assert.equal(survived.frames[0].panels[0].assetId, reusableChoice.id);
    await purgeProject(guard, copyId);
    created.splice(created.indexOf(copyId), 1);
  } finally {
    for (const projectId of created) {
      await purgeProject(guard, projectId).catch(async () => {
        await guard.query("ROLLBACK").catch(() => {});
      });
    }
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("duplicate rejects a missing source and an invalid title without creating a project", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 60000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const before = await pool.query(`SELECT count(*)::int AS count FROM project`);
    const missing = await duplicateProject(pool, "00000000-0000-4000-8000-000000000099", "Копия");
    assert.equal(missing.kind, "not-found");
    const empty = await duplicateProject(pool, "00000000-0000-4000-8000-000000000001", "");
    assert.equal(empty.kind, "invalid-request");
    const blank = await duplicateProject(pool, "00000000-0000-4000-8000-000000000001", "   ");
    assert.equal(blank.kind, "invalid-request");
    const overlong = await duplicateProject(pool, "00000000-0000-4000-8000-000000000001", "Я".repeat(121));
    assert.equal(overlong.kind, "invalid-request");
    const after = await pool.query(`SELECT count(*)::int AS count FROM project`);
    assert.equal(after.rows[0].count, before.rows[0].count);
  } finally {
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
