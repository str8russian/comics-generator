export const CLASSES = ['SUPPORTED', 'UNSUPPORTED', 'UNTESTED', 'INCONCLUSIVE'];

const REJECTION = /unrecognized|unknown parameter|unsupported|not supported|unexpected|extra.?forbidden|invalid parameter|does not support|is not allowed|unknown field/i;

export function looksLikeParameterRejection(fieldName, errorText) {
  const text = String(errorText ?? '');
  const field = String(fieldName ?? '').toLowerCase();
  const spaced = field.replace(/_/g, ' ');
  const compact = field.replace(/_/g, '');
  const haystack = text.toLowerCase();
  const mentions = haystack.includes(field) || haystack.includes(spaced) || haystack.includes(compact);
  if (!mentions) return false;
  return REJECTION.test(text);
}

export function classifyMinimal(obs) {
  if (!obs) return 'UNTESTED';
  if (obs.transportError) return 'INCONCLUSIVE';
  if (obs.httpStatus >= 200 && obs.httpStatus < 300 && obs.hasContent && obs.finishReason) return 'SUPPORTED';
  if (obs.httpStatus >= 400) return 'UNSUPPORTED';
  return 'INCONCLUSIVE';
}

export function classifyAcceptedParameter(obs) {
  if (!obs) return 'UNTESTED';
  if (obs.transportError) return 'INCONCLUSIVE';
  if (obs.parameterRejected) return 'UNSUPPORTED';
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) {
    if (obs.parameterIgnored) return 'INCONCLUSIVE';
    if (obs.effectivenessObserved === true) return 'SUPPORTED';
    return 'INCONCLUSIVE';
  }
  if ((obs.httpStatus === 400 || obs.httpStatus === 422) && /response_format|reasoning_effort|max_tokens|max_completion_tokens/i.test(obs.error ?? '')) {
    return 'UNSUPPORTED';
  }
  return 'INCONCLUSIVE';
}

export function assessReasoning(obs) {
  if (!obs) return { classification: 'UNTESTED', acceptance: 'UNTESTED', effectiveness: 'NOT_OBSERVABLE' };
  if (obs.transportError) return { classification: 'INCONCLUSIVE', acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
  if (obs.parameterRejected || ((obs.httpStatus === 400 || obs.httpStatus === 422) && looksLikeParameterRejection('reasoning_effort', obs.error))) {
    return { classification: 'UNSUPPORTED', acceptance: 'REJECTED', effectiveness: 'NOT_APPLICABLE' };
  }
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) {
    const echoed = typeof obs.reasoningEffortEcho === 'string' && obs.reasoningEffortEcho === obs.requestedEffort;
    if (echoed) return { classification: 'SUPPORTED', acceptance: 'ACCEPTED', effectiveness: 'OBSERVED' };
    return { classification: 'INCONCLUSIVE', acceptance: 'ACCEPTED', effectiveness: 'NOT_OBSERVABLE' };
  }
  return { classification: 'INCONCLUSIVE', acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
}

export function outputLimitEffectiveness(obs) {
  if (!obs || obs.transportError || !(obs.httpStatus >= 200 && obs.httpStatus < 300)) return 'NOT_APPLICABLE';
  if (obs.finishReason === 'length') return 'OBSERVED';
  const limit = obs.limit;
  if (typeof obs.completionTokens === 'number' && typeof limit === 'number' && obs.completionTokens > limit) return 'NOT_APPLIED';
  if (obs.completionTokens == null && typeof limit === 'number' && (obs.contentLength ?? 0) > limit * 8) return 'NOT_APPLIED';
  return 'NOT_OBSERVABLE';
}

export function assessOutputLimit(obs) {
  if (!obs) return { classification: 'UNTESTED', acceptance: 'UNTESTED', effectiveness: 'NOT_OBSERVABLE' };
  if (obs.transportError) return { classification: 'INCONCLUSIVE', acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
  const effectiveness = outputLimitEffectiveness(obs);
  if (obs.parameterRejected) return { classification: 'UNSUPPORTED', acceptance: 'REJECTED', effectiveness: 'NOT_APPLICABLE' };
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) {
    if (effectiveness === 'OBSERVED') return { classification: 'SUPPORTED', acceptance: 'ACCEPTED', effectiveness };
    if (effectiveness === 'NOT_APPLIED') return { classification: 'INCONCLUSIVE', acceptance: 'ACCEPTED', effectiveness };
    return { classification: 'INCONCLUSIVE', acceptance: 'ACCEPTED', effectiveness: 'NOT_OBSERVABLE' };
  }
  if ((obs.httpStatus === 400 || obs.httpStatus === 422) && looksLikeParameterRejection(obs.field, obs.error)) {
    return { classification: 'UNSUPPORTED', acceptance: 'REJECTED', effectiveness: 'NOT_APPLICABLE' };
  }
  return { classification: 'INCONCLUSIVE', acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
}

export function assessJsonMode(obs) {
  const classification = classifyJsonMode(obs);
  if (!obs) return { classification, acceptance: 'UNTESTED', effectiveness: 'NOT_OBSERVABLE' };
  if (obs.transportError) return { classification, acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
  if (classification === 'UNSUPPORTED') return { classification, acceptance: 'REJECTED', effectiveness: 'NOT_APPLICABLE' };
  if (obs.httpStatus >= 200 && obs.httpStatus < 300 && classification === 'SUPPORTED') {
    return { classification, acceptance: 'ACCEPTED', effectiveness: 'OBSERVED' };
  }
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) {
    return { classification, acceptance: 'ACCEPTED', effectiveness: 'NOT_OBSERVABLE' };
  }
  return { classification, acceptance: 'INCONCLUSIVE', effectiveness: 'NOT_OBSERVABLE' };
}

export function classifyJsonMode(obs) {
  if (!obs) return 'UNTESTED';
  if (obs.transportError) return 'INCONCLUSIVE';
  if (obs.parameterRejected) return 'UNSUPPORTED';
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) {
    if (obs.jsonParsed !== true) return 'INCONCLUSIVE';
    if (obs.schemaRequired === true) return obs.schemaConformed === true ? 'SUPPORTED' : 'INCONCLUSIVE';
    return 'SUPPORTED';
  }
  if ((obs.httpStatus === 400 || obs.httpStatus === 422) && /response_format|json_schema|json_object|structured/i.test(obs.error ?? '')) {
    return 'UNSUPPORTED';
  }
  return 'INCONCLUSIVE';
}

export function classifyInvalidBody(obs) {
  if (!obs) return 'UNTESTED';
  if (obs.transportError || obs.secretLeaked) return 'INCONCLUSIVE';
  if (obs.httpStatus >= 400 && obs.httpStatus < 500 && obs.error) return 'SUPPORTED';
  if (obs.httpStatus >= 200 && obs.httpStatus < 300) return 'UNSUPPORTED';
  return 'INCONCLUSIVE';
}

export function classifyResponseMetadata(obs) {
  if (!obs || obs.transportError || !(obs.httpStatus >= 200 && obs.httpStatus < 300)) {
    return { classification: 'UNTESTED', missing: ['httpStatus', 'contentType', 'finishReason', 'usage'] };
  }
  const missing = [];
  if (!obs.contentType) missing.push('contentType');
  if (!obs.finishReason) missing.push('finishReason');
  if (!obs.usagePresent) missing.push('usage');
  return { classification: missing.length ? 'INCONCLUSIVE' : 'SUPPORTED', missing };
}

export function aggregateFullStoryboard(classifications) {
  if (classifications.includes('SUPPORTED')) return 'SUPPORTED';
  if (classifications.includes('UNSUPPORTED')) return 'UNSUPPORTED';
  if (classifications.length === 0) return 'UNTESTED';
  return 'INCONCLUSIVE';
}

export function classifyFullStoryboard(obs) {
  if (!obs) return 'UNTESTED';
  if (obs.transportError) return 'INCONCLUSIVE';
  const complete = obs.httpStatus >= 200 && obs.httpStatus < 300
    && obs.finishReason === 'stop'
    && obs.jsonParsed === true
    && obs.schemaValid === true
    && obs.fixtureMatch === true
    && obs.truncated !== true;
  if (complete) return 'SUPPORTED';
  const blockedDespiteVerifiedLimit = obs.explicitOutputLimitVerified === true
    && obs.fixtureMatch !== true
    && (obs.truncated === true || obs.sizeRejected === true);
  if (blockedDespiteVerifiedLimit) return 'UNSUPPORTED';
  return 'INCONCLUSIVE';
}

export function storyboardSuitability(classification, obs = {}) {
  if (classification === 'UNTESTED') {
    return 'Not observed. The live suite did not verify whether one completion can return a complete Structure storyboard.';
  }
  if (classification === 'SUPPORTED') {
    return 'The endpoint returned the complete synthetic fixture in one normal completion. That is size evidence only, not an application architecture decision.';
  }
  if (classification === 'UNSUPPORTED' && obs.explicitOutputLimitVerified === true) {
    return 'The request used a verified explicit output limit large enough for the representative fixture and still did not return that fixture complete. Chunking or continuation may be required. That is an observation, not an application architecture decision.';
  }
  return 'The full-payload result is inconclusive. A shortened, altered, or default-limit response does not show whether chunking is required.';
}
