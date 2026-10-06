# Contest Chat Completions spike

Isolated probe of an OpenAI-compatible `POST /v1/chat/completions` endpoint. It is not a provider adapter, and the application does not import it.

The probe schema and the synthetic Russian fixture exist only to measure whether one completion can return a Structure-storyboard-sized JSON document. They are not the application contract. This spike does not modify `schema/`, `tools/validate.mjs`, or `FrameRenderer`.

## Offline

```sh
npm run spike:contest-api
```

Offline tests use a local fake HTTP server. They do not read credentials and do not make network calls.

## Live

From the repository root:

```sh
cp .env.example .env.local
```

Fill `BASE_URL`, `CONTEST_API_TOKEN`, and `CONTEST_MODEL` in `.env.local` with the organizer-provided values. `.env.example` is the only tracked template. Never commit `.env.local`.

```sh
npm run spike:contest-api:live
```

That command loads `.env.local` with Node's `--env-file-if-exists`. A missing file is not an error. For each variable, a value already set in the parent process is kept, including an empty string. `.env.local` supplies a variable only when the parent process has not set it. A blank required value counts as absent. If `BASE_URL`, `CONTEST_API_TOKEN`, and `CONTEST_MODEL` are not all non-empty after that, the command prints `LIVE SKIPPED` and classifies every capability as `UNTESTED`.

Optional variables, from the same sources:

- `CONTEST_TIMEOUT_MS` — client timeout, default 120000
- `CONTEST_REQUEST_JSON` — JSON object merged into each request body; probe fields override it

Do not put the token on a command line, in chat, or in any tracked file. Offline tests invoke the live script directly and do not load `.env.local`.

The live plan makes 9 sequential requests and will not exceed 10. It does not retry. A full-storyboard result is `SUPPORTED` only when the completion finishes normally and the parsed JSON matches the whole fixture. A schema-valid but shorter or altered document is `INCONCLUSIVE`. Chunking is mentioned only when that request used a verified explicit output limit and still did not return the fixture. A 2xx `reasoning_effort` response is recorded as accepted; the level is marked effective only when response metadata echoes it. `json_schema` is compatible only when the object matches the requested probe schema; that is observed compatibility, not proof of universal enforcement. `json_object` treats a parsed object as compatibility and cannot separate server enforcement from the model following the prompt.

The report records the resolved endpoint path, request shape, HTTP status, content type, `finish_reason`, usage field names, parameter acceptance, effectiveness, and a shortened error. It does not record message content, credentials, query parameters, or the host. The gitignored file is `results/capability-report.json`.
