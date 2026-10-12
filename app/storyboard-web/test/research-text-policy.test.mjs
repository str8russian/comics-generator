import assert from "node:assert/strict";
import test from "node:test";
import { assertResearchSubmittedTextSafe } from "../research-text-policy.mjs";

function expectProtected(text, label) {
  let error;
  try {
    assertResearchSubmittedTextSafe(text);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, label);
  assert.equal(error.kind, "protected-content", label);
  const message = String(error.message || error);
  const serialized = JSON.stringify(error);
  assert.equal(message.includes(text), false, `message must not echo secret (${label})`);
  assert.equal(serialized.includes(text), false, `error must not echo secret (${label})`);
}

test("ordinary Russian owner prose passes byte-for-byte", () => {
  const prose = "Заметка владельца: кадр 3 выглядит слабее, чем структура ожидала.";
  assert.equal(assertResearchSubmittedTextSafe(prose), prose);
});

test("rejects Authorization and Bearer credential forms without echoing them", () => {
  expectProtected("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def", "Authorization Bearer");
  expectProtected("Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature", "Bearer token");
  expectProtected("prefix bearer super-secret-token-value suffix", "lowercase bearer");
});

test("rejects credential-bearing URLs and DSNs without echoing them", () => {
  expectProtected("postgres://comics:super-secret-db@127.0.0.1:5432/comics", "postgres DSN");
  expectProtected("https://user:p%40ss@example.test/path", "https userinfo");
});

test("rejects sensitive URL query parameters without echoing them", () => {
  for (const param of ["token", "access_token", "api_key", "password", "secret", "signature"]) {
    expectProtected(
      `https://example.test/callback?${param}=leak-value-123&ok=1`,
      `query ${param}`,
    );
  }
});

test("rejects data:*;base64 payloads including images without echoing them", () => {
  expectProtected("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "image data url");
  expectProtected("note with data:application/octet-stream;base64,AAAA embedded", "generic data base64");
});
