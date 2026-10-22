import {
  anchorSessionProviderTimeoutMs,
  resolveImageModel,
} from "../../../app/storyboard-web/image-provider.mjs";
import { loadImageReferenceConfig } from "../../../app/storyboard-web/image-reference-strategy.mjs";
import { ASPECT_RATIO, ATTEMPT_ORDER, DISPLAY_CODE_ORDER, SAME_IDENTITY_STATEMENT, SEED_NOTE } from "./constants.mjs";
import { publicInputRecord } from "./evidence.mjs";

export function resolveRunConfig(env = process.env) {
  const referenceConfig = loadImageReferenceConfig(env);
  const model = resolveImageModel(env);
  const timeoutMs = anchorSessionProviderTimeoutMs(env);
  const providerConfigured = Boolean(String(env.BASE_URL ?? "").trim() && String(env.CONTEST_API_TOKEN ?? "").trim() && model);
  return {
    referenceConfig,
    model,
    timeoutMs,
    aspectRatio: ASPECT_RATIO,
    providerConfigured,
  };
}

export function buildPreflight({ config, inputs, git = {} }) {
  return {
    callCounter: 0,
    model: config.model,
    timeoutMs: config.timeoutMs,
    aspectRatio: config.aspectRatio,
    strategy: config.referenceConfig.ok ? config.referenceConfig.strategy : null,
    budgetBytes: config.referenceConfig.ok ? config.referenceConfig.budgetBytes : null,
    providerConfigured: config.providerConfigured,
    seed: null,
    repeatVariation: SEED_NOTE,
    sameIdentityStatement: SAME_IDENTITY_STATEMENT,
    attemptOrder: ATTEMPT_ORDER,
    displayCodeOrder: DISPLAY_CODE_ORDER,
    gitHead: git.head || null,
    gitStatus: git.status || "",
    inputs: Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, publicInputRecord(input)])),
  };
}
