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

It makes one known-under-limit `anchor + current` control from the 600 px set. Only if that control returns a usable image does it send one historical full-size `anchor + style + current` passthrough request. It never retries, never runs from the test suite, and stops after at most two calls. The gitignored `limit-check-report.json` states one of:

- the provider is unhealthy, and the legacy probe was not sent;
- the under-limit control works, but the historical body is still rejected;
- both work, so the external limit appears to have been relaxed.
