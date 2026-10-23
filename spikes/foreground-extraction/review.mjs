export const OWNER_REVIEW_SCHEMA = "spike-a-stage-a1-owner-review/v1";
export const OWNER_JUDGEMENTS = Object.freeze(["accept", "reject", "uncertain"]);
export const STAGE_A2_OWNER_REVIEW_SCHEMA = "spike-a-stage-a2-owner-review/v1";
export const STAGE_A2_OWNER_JUDGEMENTS = Object.freeze(["accept", "review", "reject"]);

export function buildOwnerReviewExport({
  runId,
  manifestHash,
  items,
  exportedAt = new Date().toISOString(),
}) {
  if (!runId || typeof runId !== "string") {
    throw new Error("owner review requires a run id");
  }
  if (!/^[a-f0-9]{64}$/.test(manifestHash || "")) {
    throw new Error("owner review requires a manifest sha256");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("owner review requires items");
  }
  const normalized = items.map((item) => {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
      throw new Error("owner review item id is invalid");
    }
    const judgement = item.judgement ?? null;
    if (judgement !== null && !OWNER_JUDGEMENTS.includes(judgement)) {
      throw new Error(`unsupported judgement: ${judgement}`);
    }
    const note = item.note == null ? "" : String(item.note);
    if (note.length > 500) {
      throw new Error("owner review note exceeds 500 characters");
    }
    const automaticStatus = item.automaticStatus;
    if (!["candidate-pass", "review", "reject"].includes(automaticStatus)) {
      throw new Error(`unsupported automatic status for ${item.id}`);
    }
    return {
      id: item.id,
      automaticStatus,
      judgement,
      note,
    };
  });
  return {
    schema: OWNER_REVIEW_SCHEMA,
    runId,
    manifestHash,
    exportedAt,
    reloadLossDisclosed: true,
    persistence: "browser-memory-only",
    items: normalized,
  };
}

export function buildStageA2OwnerReviewExport({
  runId,
  manifestHash,
  items,
  exportedAt = new Date().toISOString(),
}) {
  if (!runId || typeof runId !== "string") throw new Error("owner review requires a run id");
  if (!/^[a-f0-9]{64}$/.test(manifestHash || "")) throw new Error("owner review requires a manifest sha256");
  if (!Array.isArray(items) || items.length === 0) throw new Error("owner review requires items");
  const normalized = items.map((item) => {
    if (!item || typeof item.id !== "string" || !/^identity-[123]-(anchor|panel-close|panel-gesture)$/.test(item.id)) {
      throw new Error("owner review item id is invalid");
    }
    const attemptState = item.attemptState;
    if (!["succeeded", "failed", "unattempted"].includes(attemptState)) {
      throw new Error(`unsupported attempt state for ${item.id}`);
    }
    const automaticStatus = item.automaticStatus ?? null;
    if (attemptState === "succeeded" && !["candidate-pass", "review", "reject"].includes(automaticStatus)) {
      throw new Error(`unsupported automatic status for ${item.id}`);
    }
    if (attemptState !== "succeeded" && automaticStatus != null) {
      throw new Error(`automatic status requires a generated cell: ${item.id}`);
    }
    const judgement = item.judgement ?? null;
    if (judgement !== null && !STAGE_A2_OWNER_JUDGEMENTS.includes(judgement)) {
      throw new Error(`unsupported judgement: ${judgement}`);
    }
    if (judgement !== null && attemptState !== "succeeded") {
      throw new Error(`judgement requires a generated cell: ${item.id}`);
    }
    const note = item.note == null ? "" : String(item.note);
    if (note.length > 500) throw new Error("owner review note exceeds 500 characters");
    return {
      id: item.id,
      identityId: item.identityId,
      cell: item.cell,
      attemptState,
      automaticStatus,
      reviewRisk: item.reviewRisk === true,
      judgement,
      note,
    };
  });
  return {
    schema: STAGE_A2_OWNER_REVIEW_SCHEMA,
    runId,
    manifestHash,
    exportedAt,
    reloadLossDisclosed: true,
    persistence: "browser-memory-only",
    prefilled: false,
    items: normalized,
  };
}
