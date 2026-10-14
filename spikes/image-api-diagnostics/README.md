# Image API diagnostics spike

An isolated, owner-authorized probe for the OpenAI-compatible image endpoint used by the storyboard app. It does not read or write storyboard state. The live matrix is capped at six sequential calls and never retries.

The probe uses the production `buildImageRequest` serializer and records only sanitized transport evidence: fixture hashes and dimensions, reference roles, request byte length and SHA-256, safe response headers, HTTP status, latency, and a shortened provider error. It never records credentials, the provider host, prompt text, request bodies, response bodies, or input image bytes.

## Fixtures

Create local, untracked fixtures with these names:

```text
spikes/image-api-diagnostics/fixtures/
├── full/
│   ├── anchor.png
│   ├── style.png
│   └── current.png
├── 1024/
│   ├── anchor.png
│   ├── style.png
│   └── current.png
└── 768/
    ├── anchor.png
    ├── style.png
    └── current.png
```

The separately authorized threshold confirmation also uses a `740/` set with the same three filenames.

The three `full` files should be exact copies of one known failing request. The resized sets must preserve the same role mapping and aspect ratios. PNG, JPEG, and WebP are accepted; the extension shown above is only the default filename.

An alternative fixture root may be supplied through `IMAGE_SPIKE_FIXTURE_DIR`. Within each size directory, the probe discovers `anchor`, `style`, and `current` with one supported image extension.

## Offline

```sh
npm run spike:image-api
```

## Live

The command reads `BASE_URL`, `CONTEST_API_TOKEN`, optional `IMAGE_MODEL`, and optional `IMAGE_TIMEOUT_MS`/`CONTEST_TIMEOUT_MS` from the same environment as the app:

```sh
npm run spike:image-api:live
```

The sequence is:

1. no-reference health generation;
2. full-size anchor + style initial generation;
3. full-size anchor + current revision;
4. full-size anchor + style + current production revision;
5. the same three roles at 1024 px, only if step 4 returns `413`;
6. the same three roles at 768 px, only if step 5 also returns `413`.

If the health request fails, the matrix stops. Successful output images and `diagnostic-report.json` are written under the gitignored `results/` directory.

After the initial matrix, a separately authorized two-call threshold confirmation can be run with:

```sh
npm run spike:image-api:threshold
```

It sends `anchor + current` from the 768 px set, then all three roles from the 740 px set. It writes `threshold-report.json` and never retries.

The final, separately authorized one-call check below the suspected 1 MB gateway limit uses the 600 px `anchor + current` set:

```sh
npm run spike:image-api:under-limit
```

It writes `under-limit-report.json` and refuses to make more than one request.

A later, separately authorized check for whether the external gateway limit has been removed is:

```sh
npm run spike:image-api:limit-check
```

It makes one known-under-limit `anchor + current` control from the 600 px set. Only if that control returns a usable image does it send one historical full-size `anchor + style + current` passthrough request. It never retries, never runs from the test suite, and stops after at most two real image calls. While a request is in flight it prints connection progress and a heartbeat every 5 seconds. The gitignored `limit-check-report.json` is rewritten after every completed case and states one of:

- the provider is unhealthy, and the legacy probe was not sent;
- the under-limit control works, but the historical body is still rejected;
- both work, so the external limit appears to have been relaxed.

## Image-bearing 200 versus 413 threshold

```sh
npm run spike:image-api:image-threshold
```

This command is separate from both `limit-check` and `payload-threshold`. It sends valid production-shaped Chat Completions requests: the configured image model, aspect ratio `5:4`, a fixed short revision instruction, and real PNG references in role order. Successful observations are real, potentially billable image generations. The current authorization cap is 30 image-bearing requests and 30 successful generations. The command enforces both caps, does not retry, and stops on any result other than a valid image or HTTP 413.

`payload-threshold` is only a JSON negative control. It does not measure this image-bearing limit. `limit-check` remains the two-call historical image check and is not part of this search.

The search reports the exact UTF-8 size of the serialized JSON body, plus each reference file size and their sum. A confirmed result requires the successful and HTTP 413 bodies to be at most 10,240 bytes apart, with one extra confirmation request at each end. It then checks whether `anchor + style + current` follows the same body boundary. Production stays on `IMAGE_REFERENCE_STRATEGY=budgeted` and `IMAGE_REQUEST_BUDGET_BYTES=850000`; this command does not change them.

A non-empty `image-threshold-report.json` blocks another run unless `IMAGE_THRESHOLD_RERUN=1` is set explicitly. Do not set that flag for an ordinary measurement. The report and any returned images stay in the gitignored `results/` directory.

## Exact JSON body threshold

```sh
npm run spike:image-api:payload-threshold
```

This command is separate from `limit-check`. It does not generate images and does not call the production image serializer. Each request is valid JSON with only `model` and `diagnostic_padding`, and it deliberately omits `messages`, prompts, modalities, and image data so the gateway cannot start an image generation. The measurement is the exact UTF-8 byte length of that serialized HTTP body. It is not a universal maximum source-image size: production requests also carry base64 image data, prompts, and JSON overhead.

The search starts with a small validation baseline, then brackets and binary-searches between `IMAGE_PAYLOAD_THRESHOLD_LOW_BYTES` (default `700000`) and `IMAGE_PAYLOAD_THRESHOLD_HIGH_BYTES` (default `1400000`). Those overrides must be positive integers inside the hard ceiling of `8000000` bytes. The command stops on an inconclusive status, confirms adjacent boundary sizes with separate probes, and will not exceed 64 requests. It prints the same lifecycle progress and five-second heartbeat as `limit-check`, including the current range and target body size.

The gitignored `payload-threshold-report.json` is rewritten after every observation. Production stays on `IMAGE_REFERENCE_STRATEGY=budgeted` and `IMAGE_REQUEST_BUDGET_BYTES=850000`; this experiment does not change them.
