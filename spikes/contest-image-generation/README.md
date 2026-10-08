# Contest image generation spike

Isolated check of whether `gemini-3-pro-image-preview`, reached through the contest API, can carry the character-image workflow: a base identity anchor, a derived state, a performance-heavy state, and a layout rendition.

This is not a provider adapter. The application does not import it. The server does not call the contest API when it starts, and it does not send a generation request until a discovery run has verified the request shape.

## Offline

```sh
npm run spike:contest-image
```

Offline tests use a local fake HTTP server or an injected fetch. They do not read credentials and they do not call the contest host.

## Local UI

From the repository root:

```sh
npm run spike:contest-image:serve
```

The page is served on `127.0.0.1`. Credentials stay on the server.

Set `CONTEST_ENV_FILE` to an env file that already contains `BASE_URL` and `CONTEST_API_TOKEN`, or place an untracked `.env.local` in the working directory. A value already set in the process is kept. The file is used only for variables the process has not set. The model is fixed to `gemini-3-pro-image-preview`.

Optional `CONTEST_TIMEOUT_MS` overrides the client timeout. Optional `IMAGE_SPIKE_PORT` chooses the local port. Optional `IMAGE_SPIKE_RUNS_DIR` chooses where artifacts are written.

`catalog/local-paths.json` is gitignored and maps logical reference ids to local files. `catalog/local-paths.example.json` lists the ids with empty paths. Do not commit either file with machine paths filled in.

## What the page does

Select one experiment, read the role of every reference, edit the prompt, and send exactly one request. A batch is limited to three selected experiments and uses each template prompt. The transport probe is a separate button and sends exactly one Chat Completions request over HTTP/1.1, with image and text modalities and no reference images. OpenAPI discovery is optional: a network failure is recorded as `network-blocked` and does not prevent that probe. A broader discovery run still stops at four outbound HTTP requests. Documentation, generation, reference, invalid-body, and same-host image-URL downloads all count. A signed `http` or `https` image URL is fetched only when its host matches the provider and a request remains in that budget. The URL and its query are not stored. If the budget is already spent, the download is left as `pending-image-download` for a later run.

Every live HTTP request, including a failed one, increments the campaign counter shown on the page. The first-campaign envelope is about 50 calls: 4 discovery, 9 anchors, 18 derived and performance-heavy states, 10 layout renditions, 6 accepted-recipe repetitions, and 3 diagnostic corrections. That envelope is a research plan, not a permanent product limit.

After two prompt-tweak retries of the same failure class, another prompt tweak is refused. Change technique: a different reference composition, an edit of an accepted image, or a layout rendition derived from an accepted state.

The page does not use `localStorage`. It does not receive the token.

## Artifacts

`runs/` is gitignored. Each live call writes a manifest and, when the provider returns an image, a separate image file. Manifests may contain local paths. `POST /api/exports` writes a sanitized evidence package that omits absolute paths, the provider host, authorization, raw bodies, and base64 image data.

## Unverified until a live discovery batch

No live image request has been made by this spike yet. Endpoint, request format, reference images, editing, aspect ratio, output representation, usage, and error behavior stay unverified until that batch is approved and run.
