import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";

export const HEARTBEAT_INTERVAL_MS = 5000;
export const SAFE_HEADERS = ["server", "content-type", "content-length", "x-request-id", "request-id", "x-trace-id", "cf-ray"];
const TIMING_KEYS = ["socketMs", "dnsMs", "tcpMs", "tlsMs", "finishMs", "ttfbMs", "totalMs"];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function chatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) url.pathname = path;
  else if (path.endsWith("/v1")) url.pathname = `${path}/chat/completions`;
  else url.pathname = `${path}/v1/chat/completions`;
  url.search = "";
  url.hash = "";
  return url;
}

function redact(value, secrets) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

export function sanitizeTimings(timings) {
  if (!timings || typeof timings !== "object") return {};
  const out = {};
  for (const key of TIMING_KEYS) {
    if (Number.isInteger(timings[key]) && timings[key] >= 0) out[key] = timings[key];
  }
  return out;
}

export function sanitizeHeaders(headers, secrets = []) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const name of SAFE_HEADERS) {
    const value = headers[name];
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    out[name] = redact(text, secrets).slice(0, 180);
  }
  return out;
}

function safeToken(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.:+-]/g, "").slice(0, 80);
}

function wholeNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function hashPrefix(value) {
  const text = String(value ?? "").toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(text) ? text.slice(0, 12) : "unknown";
}

export function formatProgressLine(event = {}) {
  const index = wholeNumber(event.index);
  const total = wholeNumber(event.total);
  const elapsed = Number.isFinite(Number(event.elapsedMs)) ? Number(event.elapsedMs) : 0;
  const stamp = `+${(elapsed / 1000).toFixed(1)}s`;
  const type = safeToken(event.type);
  if (type === "heartbeat") {
    return `[${index}/${total} ${stamp}] Still waiting for response\n`;
  }
  if (type === "before-request") {
    const id = safeToken(event.id || event.purpose) || "request";
    const roles = Array.isArray(event.roles) ? event.roles.map(safeToken).filter(Boolean) : null;
    const rolePart = roles ? ` roles=${roles.join("+") || "none"} count=${roles.length}` : "";
    const range = Number.isInteger(event.rangeLow) && Number.isInteger(event.rangeHigh)
      ? ` range=${event.rangeLow}..${event.rangeHigh}`
      : "";
    const target = Number.isInteger(event.targetBytes) ? ` target=${event.targetBytes}` : "";
    return `[${index}/${total}] ${id}${range}${target}${rolePart} body=${wholeNumber(event.byteLength)} sha256=${hashPrefix(event.sha256Prefix)} timeout=${wholeNumber(event.timeoutMs)}ms\n`;
  }
  if (type === "response-headers") {
    return `[${index}/${total} ${stamp}] response headers received HTTP ${wholeNumber(event.httpStatus)}\n`;
  }
  if (type === "timings") {
    const labels = [
      ["socketMs", "socket"],
      ["dnsMs", "dns"],
      ["tcpMs", "tcp"],
      ["tlsMs", "tls"],
      ["finishMs", "finish"],
      ["ttfbMs", "ttfb"],
      ["totalMs", "total"],
    ];
    const parts = labels.flatMap(([key, label]) => (
      Number.isInteger(event.timings?.[key]) ? [`${label}=${event.timings[key]}ms`] : []
    ));
    return `[${index}/${total}] timings ${parts.join(" ")}\n`;
  }
  const labels = {
    "request-created": "request created",
    socket: "socket assigned",
    dns: "DNS lookup completed",
    tcp: "TCP connected",
    tls: "TLS secure connection completed",
    "request-finish": "request body handed to socket",
    "response-complete": "response body completed",
    timeout: "timeout",
    abort: "abort",
    "network-failure": "network failure",
  };
  return `[${index}/${total} ${stamp}] ${labels[type] || type || "event"}\n`;
}

function transportCategory(error) {
  if (error?.message === "timeout" || error?.code === "ETIMEDOUT" || error?.code === "timeout") return "timeout";
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") return "abort";
  if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") return "dns";
  return "network";
}

export function postJson(url, {
  token,
  body,
  timeoutMs,
  onEvent,
  now = () => Date.now(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (timer) => clearInterval(timer),
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
  requestImpl,
} = {}) {
  const target = url instanceof URL ? url : new URL(url);
  const bytes = Buffer.from(body);
  const started = now();
  const timings = {};
  let heartbeat = null;
  let settled = false;
  let headersSeen = false;
  const secrets = [token].filter((value) => typeof value === "string" && value.length >= 4);

  const emit = (type, extra = {}) => {
    onEvent?.({
      type,
      elapsedMs: Math.max(0, now() - started),
      timings: sanitizeTimings(timings),
      ...extra,
    });
  };
  const mark = (key) => {
    if (timings[key] == null) timings[key] = Math.max(0, now() - started);
  };
  const stopHeartbeat = () => {
    if (heartbeat != null) {
      clearTimer(heartbeat);
      heartbeat = null;
    }
  };
  const startHeartbeat = () => {
    if (heartbeat != null || settled || headersSeen) return;
    heartbeat = setTimer(() => emit("heartbeat"), heartbeatMs);
  };

  emit("request-created");
  const request = requestImpl || (target.protocol === "https:" ? httpsRequest : httpRequest);
  return new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      stopHeartbeat();
      mark("totalMs");
      resolve({
        ...result,
        latencyMs: Math.max(0, now() - started),
        timings: sanitizeTimings(timings),
      });
    };
    const req = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "content-length": String(bytes.length),
      },
      ALPNProtocols: ["http/1.1"],
      servername: target.hostname,
      timeout: timeoutMs,
    }, (response) => {
      headersSeen = true;
      stopHeartbeat();
      mark("ttfbMs");
      emit("response-headers", { httpStatus: response.statusCode ?? 0 });
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", () => finish({
        status: response.statusCode ?? 0,
        headers: sanitizeHeaders(response.headers, secrets),
        text: "",
        transportError: "network",
      }));
      response.on("end", () => {
        emit("response-complete", { httpStatus: response.statusCode ?? 0 });
        finish({
          status: response.statusCode ?? 0,
          headers: sanitizeHeaders(response.headers, secrets),
          text: Buffer.concat(chunks).toString("utf8"),
          transportError: null,
        });
      });
    });
    req.on("socket", (socket) => {
      mark("socketMs");
      emit("socket");
      socket.on("lookup", (lookupError) => {
        if (lookupError) return;
        mark("dnsMs");
        emit("dns");
      });
      socket.on("connect", () => {
        mark("tcpMs");
        emit("tcp");
      });
      if (target.protocol === "https:") {
        socket.on("secureConnect", () => {
          mark("tlsMs");
          emit("tls");
        });
      }
    });
    req.on("finish", () => {
      mark("finishMs");
      emit("request-finish");
      startHeartbeat();
    });
    req.on("timeout", () => {
      stopHeartbeat();
      req.destroy(Object.assign(new Error("timeout"), { code: "timeout" }));
    });
    req.on("error", (error) => {
      const category = transportCategory(error);
      emit(category === "network" ? "network-failure" : category);
      finish({
        status: 0,
        headers: {},
        text: "",
        transportError: category,
      });
    });
    req.end(bytes);
  });
}

export function writeReportAtomic(resultsDir, filename, report) {
  mkdirSync(resultsDir, { recursive: true });
  const target = join(resultsDir, filename);
  const temporary = join(resultsDir, `.${filename}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, target);
  return target;
}

export function createIncrementalReport({
  resultsDir,
  filename,
  initial,
  nowIso = () => new Date().toISOString(),
}) {
  let report = {
    ...initial,
    startedAt: initial.startedAt || nowIso(),
    lastUpdatedAt: nowIso(),
  };
  return {
    path: join(resultsDir, filename),
    current() {
      return report;
    },
    save(patch = {}) {
      report = { ...report, ...patch, lastUpdatedAt: nowIso() };
      writeReportAtomic(resultsDir, filename, report);
      return report;
    },
  };
}

export function bindInterrupt(onInterrupt, {
  subscribe = (event, handler) => process.on(event, handler),
  exit = (code) => process.exit(code),
} = {}) {
  const handler = () => {
    try {
      onInterrupt();
    } catch {
      // The interrupt path must not print errors that could contain coordinates or secrets.
    }
    exit(130);
  };
  subscribe("SIGINT", handler);
  return handler;
}
