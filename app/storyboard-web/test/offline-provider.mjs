import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";

const sentence = "На площади люди долго обсуждали погоду, трамваи, чай и расписание.";
export const SPOKEN_TEXT = Array.from({ length: 30 }, () => sentence).join(" ");
export const FIXTURE_DRAFT = `Аня: ${SPOKEN_TEXT}`;

export const interpretResponse = {
  sourceItems: [
    {
      id: "anya",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Аня",
      sourceQuote: FIXTURE_DRAFT,
    },
  ],
};

export const stageResponse = {
  frames: [
    {
      id: "fAnya",
      layout: "split2",
      origin: "source",
      panels: [
        { description: "Аня говорит слева" },
        { description: "Пустая правая панель" },
      ],
      sourceItemId: "anya",
      sourceRole: "utterance",
      speakerPanel: 0,
    },
  ],
  review: [],
};

function compileSchema(name) {
  const schema = JSON.parse(readFileSync(new URL(`../../../specs/001-structure-storyboard-tracer/contracts/${name}`, import.meta.url), "utf8"));
  return new Ajv({ allErrors: true, strict: true }).compile(structuredClone(schema));
}

const validateInterpret = compileSchema("interpret-response.schema.json");
const validateStage = compileSchema("stage-response.schema.json");

if (!validateInterpret(structuredClone(interpretResponse))) {
  throw new Error(`interpret fixture is not schema-valid: ${JSON.stringify(validateInterpret.errors)}`);
}
if (!validateStage(structuredClone(stageResponse))) {
  throw new Error(`stage fixture is not schema-valid: ${JSON.stringify(validateStage.errors)}`);
}

function completion(content) {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  });
}

function sendJson(res, status, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function createOfflineProvider() {
  let calls = 0;
  return createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST" || requestUrl.pathname !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
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
      const user = body?.messages?.find((message) => message?.role === "user")?.content ?? "";
      calls += 1;
      if (calls === 1) {
        if (!String(user).includes(FIXTURE_DRAFT)) {
          sendJson(res, 400, { error: "unexpected-fixture" });
          return;
        }
        sendJson(res, 200, completion(interpretResponse));
        return;
      }
      if (calls === 2) {
        sendJson(res, 200, completion(stageResponse));
        return;
      }
      sendJson(res, 409, { error: "extra-completion" });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createOfflineProvider();
  server.listen(Number(process.env.OFFLINE_PROVIDER_PORT || 0), "127.0.0.1", () => {
    const address = server.address();
    if (!address || address.address !== "127.0.0.1") {
      console.error("offline provider refused to bind outside 127.0.0.1");
      server.close();
      process.exit(1);
    }
    console.log(`offline-provider http://127.0.0.1:${address.port}`);
  });
}
