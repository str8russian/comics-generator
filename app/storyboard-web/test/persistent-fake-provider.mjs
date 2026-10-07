import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";

const line1 = "Путин: Дмитрий Сергеевич, это Песков.";
const line2 = "Кто это сказал?";
export const PERSISTENT_DRAFT = `${line1}\n${line2}`;

const interpretResponse = {
  sourceItems: [
    {
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: line1,
    },
    {
      id: "u2",
      kind: "utterance",
      segmentIds: ["seg-1"],
      speakerStatus: "unresolved",
      sourceQuote: line2,
    },
  ],
  characters: [
    { id: "putin", name: "Путин" },
    { id: "peskov", name: "Песков" },
  ],
  surfaceForms: [
    { id: "putin-label", quote: "Путин", role: "speaker-label", characterId: "putin" },
    { id: "peskov-address", quote: "Дмитрий Сергеевич", role: "address" },
    { id: "peskov-mention", quote: "Песков", role: "mention", characterId: "peskov" },
  ],
};

const stageResponse = {
  frames: [
    {
      id: "f1",
      layout: "single",
      origin: "source",
      panels: [{ description: "Путин обращается к собеседнику" }],
      sourceItemId: "u1",
      sourceRole: "utterance",
      speakerPanel: 0,
    },
    {
      id: "f2",
      layout: "single",
      origin: "source",
      panels: [{ description: "Собеседник слышит вопрос" }],
      sourceItemId: "u2",
      sourceRole: "utterance",
      speakerPanel: 0,
    },
  ],
  review: [],
};

function compileSchema(fileUrl) {
  const schema = JSON.parse(readFileSync(fileUrl, "utf8"));
  return new Ajv({ allErrors: true, strict: true }).compile(structuredClone(schema));
}

const validateInterpret = compileSchema(new URL("../../../specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json", import.meta.url));
const validateStage = compileSchema(new URL("../../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url));

if (!validateInterpret(structuredClone(interpretResponse))) {
  throw new Error(`interpret fixture is not schema-valid: ${JSON.stringify(validateInterpret.errors)}`);
}
if (!validateStage(structuredClone(stageResponse))) {
  throw new Error(`stage fixture is not schema-valid: ${JSON.stringify(validateStage.errors)}`);
}

function completion(content) {
  return {
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function userContent(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.find((message) => message?.role === "user");
  return typeof user?.content === "string" ? user.content : "";
}

function requestKind(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Array.isArray(parsed.segments) && !Object.hasOwn(parsed, "sourceItems")) return "interpret";
  if (Array.isArray(parsed.sourceItems)) return "stage";
  return null;
}

export function createPersistentFakeProvider() {
  const state = { requests: 0, interpret: 0, stage: 0 };
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST" || requestUrl.pathname !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      req.resume();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendJson(res, 400, { error: "malformed-json" });
        return;
      }
      state.requests += 1;
      if (state.requests > 2) {
        sendJson(res, 409, { error: "extra-completion" });
        return;
      }
      const kind = requestKind(userContent(body));
      if (state.requests === 1) {
        if (kind !== "interpret") {
          sendJson(res, 400, { error: "unexpected-interpret" });
          return;
        }
        state.interpret += 1;
        sendJson(res, 200, completion(interpretResponse));
        return;
      }
      if (kind !== "stage") {
        sendJson(res, 400, { error: "unexpected-stage" });
        return;
      }
      state.stage += 1;
      sendJson(res, 200, completion(stageResponse));
    });
  });
  return {
    server,
    url: "",
    get interpretCount() {
      return state.interpret;
    },
    get stageCount() {
      return state.stage;
    },
  };
}

export function startPersistentFakeProvider() {
  const provider = createPersistentFakeProvider();
  return new Promise((resolve, reject) => {
    provider.server.once("error", reject);
    provider.server.listen(0, "127.0.0.1", () => {
      const address = provider.server.address();
      if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        provider.server.close();
        reject(new Error("persistent fake provider refused to bind outside 127.0.0.1"));
        return;
      }
      provider.url = `http://127.0.0.1:${address.port}`;
      resolve(provider);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPersistentFakeProvider().then((provider) => {
    console.log(provider.url);
  }, () => {
    console.error("persistent fake provider refused to bind outside 127.0.0.1");
    process.exit(1);
  });
}
