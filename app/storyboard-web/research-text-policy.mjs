/**
 * Bounded protected-content checks for research submittedText / editTarget strings.
 * Not general DLP. Rejects atomically with a fixed kind and never echoes the match.
 */

const PROTECTED_KIND = "protected-content";

const PATTERNS = [
  // Authorization / Bearer credential forms
  /\bauthorization\s*:\s*bearer\b/i,
  /\bbearer\s+[A-Za-z0-9._\-+=\/]{8,}/i,
  // Credential-bearing URLs or DSNs (userinfo password)
  /(?:postgres(?:ql)?|https?|ftp):\/\/[^/\s"'<>]+?:[^/\s"'<>]+?@/i,
  // Sensitive URL query parameters
  /[?&](?:token|access_token|api_key|apikey|password|secret|signature)=/i,
  // data:*;base64 payloads
  /data:[^;\s]+;base64,/i,
];

export class ResearchProtectedContentError extends Error {
  constructor() {
    super("protected-content");
    this.name = "ResearchProtectedContentError";
    this.kind = PROTECTED_KIND;
  }
}

export function assertResearchSubmittedTextSafe(text) {
  if (typeof text !== "string") return text;
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) {
      throw new ResearchProtectedContentError();
    }
  }
  return text;
}

export function assertResearchTextFieldsSafe(values) {
  for (const value of values) {
    if (typeof value === "string") assertResearchSubmittedTextSafe(value);
  }
}
