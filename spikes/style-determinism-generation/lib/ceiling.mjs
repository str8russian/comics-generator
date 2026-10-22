import { CALL_CEILING, SYSTEMIC_FAILURE_KINDS } from "./constants.mjs";

export function createCallCeiling({ limit = CALL_CEILING } = {}) {
  if (limit !== CALL_CEILING) throw new Error("the provider ceiling is fixed at 12");
  let attempted = 0;
  let previousKind = null;
  let halted = false;
  let haltReason = null;
  let active = 0;
  let maxActive = 0;

  return {
    get attempted() {
      return attempted;
    },
    get halted() {
      return halted;
    },
    get haltReason() {
      return haltReason;
    },
    get maxActive() {
      return maxActive;
    },
    async invoke(run) {
      if (halted || attempted >= limit) {
        return { consumed: false, reason: halted ? haltReason : "ceiling" };
      }
      attempted += 1;
      const attemptNumber = attempted;
      active += 1;
      maxActive = Math.max(maxActive, active);
      let outcome;
      try {
        outcome = await run({ attemptNumber });
      } catch {
        outcome = { ok: false, kind: "provider" };
      } finally {
        active -= 1;
      }
      const ok = Boolean(outcome?.ok);
      const kind = ok ? null : normalizeKind(outcome?.kind);
      if (!ok && previousKind === kind) {
        halted = true;
        haltReason = "consecutive-same-failure";
      }
      previousKind = ok ? null : kind;
      return {
        consumed: true,
        attemptNumber,
        ok,
        kind,
        outcome,
        halted,
        haltReason,
      };
    },
  };
}

function normalizeKind(kind) {
  const value = String(kind || "provider");
  return SYSTEMIC_FAILURE_KINDS.includes(value) ? value : "provider";
}
