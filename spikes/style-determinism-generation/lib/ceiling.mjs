import { INVOCATION_CEILING, SYSTEMIC_FAILURE_KINDS } from "./constants.mjs";
import { CROSS_IDENTITY_INVOCATION_CEILING } from "./cross-identity.mjs";

export function createCallCeiling({ limit = INVOCATION_CEILING } = {}) {
  if (limit !== INVOCATION_CEILING && limit !== CROSS_IDENTITY_INVOCATION_CEILING) {
    throw new Error("the provider invocation ceiling is fixed at 24");
  }
  let attempted = 0;
  let previousTerminalKind = null;
  let halted = false;
  let haltReason = null;
  let active = 0;
  let maxActive = 0;

  return {
    limit,
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
    noteSuccess() {
      previousTerminalKind = null;
    },
    noteTerminal(kind) {
      const normalized = normalizeFailureKind(kind);
      if (previousTerminalKind === normalized) {
        halted = true;
        haltReason = "consecutive-same-failure";
      }
      previousTerminalKind = normalized;
      return { halted, haltReason };
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
      const kind = ok ? null : normalizeFailureKind(outcome?.kind);
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

export function normalizeFailureKind(kind) {
  const value = String(kind || "provider");
  return SYSTEMIC_FAILURE_KINDS.includes(value) ? value : "provider";
}
