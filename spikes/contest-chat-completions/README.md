# Contest Chat Completions spike

Isolated probe of an OpenAI-compatible `POST /v1/chat/completions` endpoint. It is not a provider adapter, and the application does not import it.

The probe schema and the synthetic Russian fixture exist only to measure whether one completion can return a Structure-storyboard-sized JSON document. They are not the application contract. This spike does not modify `schema/`, `tools/validate.mjs`, or `FrameRenderer`.

## Offline

```sh
npm run spike:contest-api
```

Offline tests use a local fake HTTP server. They do not read credentials and do not make network calls.

## Live

Live requests run only when all three variables are set in the process environment:

- `BASE_URL`
- `CONTEST_API_TOKEN`
- `CONTEST_MODEL`

Optional request parameters, also only from the environment:

- `CONTEST_TIMEOUT_MS` — client timeout, default 120000
- `CONTEST_REQUEST_JSON` — JSON object merged into each request body; probe fields override it

Do not put the token in a file, a command line, or this directory. If the required variables are absent, the live command prints `LIVE SKIPPED` and classifies every capability as `UNTESTED`.

```sh
npm run spike:contest-api:live
```

The live plan makes 9 sequential requests and will not exceed 10. It does not retry. A full-storyboard result is `SUPPORTED` only when the completion finishes normally and the parsed JSON matches the whole fixture. A schema-valid but shorter or altered document is `INCONCLUSIVE`. Chunking is mentioned only when that request used a verified explicit output limit and still did not return the fixture. A 2xx `reasoning_effort` response is recorded as accepted; the level is marked effective only when response metadata echoes it. `json_schema` is compatible only when the object matches the requested probe schema; that is observed compatibility, not proof of universal enforcement. `json_object` treats a parsed object as compatibility and cannot separate server enforcement from the model following the prompt.

The report records the resolved endpoint path, request shape, HTTP status, content type, `finish_reason`, usage field names, parameter acceptance, effectiveness, and a shortened error. It does not record message content, credentials, query parameters, or the host. The gitignored file is `results/capability-report.json`.
