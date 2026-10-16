import { parseImageDataUrl } from "../../../app/storyboard-web/image-info.mjs";
import { generateImage, resolveImageModel } from "../../../app/storyboard-web/image-provider.mjs";
import {
  executeImageRequest,
  loadImageReferenceConfig,
  toReference,
} from "../../../app/storyboard-web/image-reference-strategy.mjs";
import { compilePrototypePrompt } from "./prompt.mjs";

const PUBLIC_KINDS = new Set([
  "configuration",
  "invalid-request",
  "provider",
  "timeout",
  "invalid-output",
  "provider-payload-too-large",
  "reference-payload-too-large",
  "echoed-source",
  "busy",
]);

function publicKind(kind) {
  return PUBLIC_KINDS.has(kind) ? kind : "provider";
}

function httpStatusFor(kind, fallback = 502) {
  if (kind === "invalid-request") return 400;
  if (kind === "busy") return 409;
  if (kind === "configuration") return 500;
  if (kind === "timeout") return 504;
  if (kind === "reference-payload-too-large") return 422;
  return fallback;
}

function failed(kind, httpStatus = httpStatusFor(kind)) {
  return { ok: false, httpStatus, kind: publicKind(kind) };
}

function readImage(value, { required }) {
  if (value == null || value === "") {
    return required ? { error: "invalid-request" } : { image: null };
  }
  if (typeof value !== "string") return { error: "invalid-request" };
  const image = parseImageDataUrl(value);
  if (!image) return { error: "invalid-request" };
  return { image };
}

function sameBytes(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

export async function generatePrototypeImage({
  body,
  env = process.env,
  imageGenerator = generateImage,
  fetchImpl,
  logger = () => {},
} = {}) {
  const started = Date.now();
  const log = (fields) => {
    logger({
      event: "prototype-generate",
      latencyMs: Date.now() - started,
      ...fields,
    });
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    log({ ok: false, kind: "invalid-request" });
    return failed("invalid-request");
  }
  const operation = body.operation;
  if (operation !== "from-source" && operation !== "refine") {
    log({ ok: false, kind: "invalid-request" });
    return failed("invalid-request");
  }
  if (body.instruction != null && typeof body.instruction !== "string") {
    log({ ok: false, kind: "invalid-request" });
    return failed("invalid-request");
  }
  const instruction = String(body.instruction || "").slice(0, 2000);
  const source = readImage(body.sourceImage, { required: operation === "from-source" });
  const anchor = readImage(body.anchorImage, { required: operation === "refine" });
  const previous = readImage(body.previousImage, { required: false });
  if (source.error || anchor.error || previous.error) {
    log({ ok: false, kind: "invalid-request" });
    return failed("invalid-request");
  }

  const references = [];
  if (operation === "refine") references.push(toReference("anchor", anchor.image));
  if (source.image) references.push(toReference("identity", source.image));
  if (previous.image) references.push(toReference("previous", previous.image));
  if (operation === "from-source" && !source.image) {
    log({ ok: false, kind: "invalid-request" });
    return failed("invalid-request");
  }

  const config = loadImageReferenceConfig(env);
  if (!config.ok) {
    log({ ok: false, kind: "configuration" });
    return failed("configuration", 500);
  }
  const model = resolveImageModel(env);
  const inputs = [source.image, anchor.image, previous.image].filter(Boolean);

  let result;
  try {
    result = await executeImageRequest({
      strategy: config.strategy,
      budgetBytes: config.budgetBytes,
      references,
      generationMode: previous.image ? "revision" : "initial",
      compilePrompt: (prepared) => compilePrototypePrompt(prepared, instruction),
      aspectRatio: "4:5",
      model,
      imageGenerator,
      env,
      fetchImpl,
    });
  } catch {
    log({ ok: false, kind: "provider", referenceCount: references.length });
    return failed("provider");
  }

  if (!result?.ok) {
    const kind = publicKind(result?.kind || "provider");
    log({
      ok: false,
      kind,
      referenceCount: references.length,
      httpStatus: result?.httpStatus || httpStatusFor(kind),
    });
    return failed(kind, result?.httpStatus || httpStatusFor(kind));
  }

  const bytes = result.image?.bytes;
  const mime = result.image?.mime;
  if (!Buffer.isBuffer(bytes) || !mime) {
    log({ ok: false, kind: "invalid-output", referenceCount: references.length });
    return failed("invalid-output");
  }
  if (inputs.some((input) => sameBytes(input.bytes, bytes))) {
    log({ ok: false, kind: "echoed-source", referenceCount: references.length });
    return failed("echoed-source");
  }

  log({ ok: true, referenceCount: references.length, outputBytes: bytes.length, mime });
  return {
    ok: true,
    httpStatus: 200,
    mime,
    imageDataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}
