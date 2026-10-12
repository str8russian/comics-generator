# Model health check

Local diagnostic page for the configured contest API. The browser never receives the provider token or base URL. Every button makes exactly one provider request and never retries automatically.

## One-click launch on macOS

Double-click `Open Model Health.command` in the repository root. It will:

1. reuse the server when it is already running;
2. otherwise start it in the background with the main checkout's `.env.local`;
3. wait until the local page is ready;
4. open <http://127.0.0.1:4321> in the default browser.

The background server survives closing the launcher Terminal window. After a reboot, double-click the launcher again.

## Manual launch

Start it from the repository root when manual control is useful:

```bash
MODEL_HEALTH_ENV_FILE=/Users/andrey/Documents/Projects/comics-pipeline/.env.local npm run spike:model-health:serve
```

Then open <http://127.0.0.1:4321>.

Checks:

- `gpt-5.5` and `claude-opus-4.8` through `POST /v1/chat/completions`;
- invalid model `opus-4.8` as a negative server-control request;
- three image models through Chat Completions with `modalities: ["image", "text"]`;
- API key quota through `GET /key/info`.

Run the offline tests with `npm run spike:model-health`.
