import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const remotionRoot = fileURLToPath(new URL("../../prototypes/remotion-rough/", import.meta.url));
const renderScript = path.join(remotionRoot, "tools", "render-spec.mjs");

export function isSafeResultPath(directory, file) {
  if (typeof file !== "string" || !file) return false;
  return path.resolve(file) === path.resolve(directory, "current.mp4");
}

export function safeRenderMessage(error) {
  const text = String(error?.publicMessage || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 240) return "Не удалось собрать видео.";
  if (/postgres:\/\/|password|secret|api[_-]?key|authorization|bearer /i.test(text)) {
    return "Не удалось собрать видео.";
  }
  return text;
}

export function createRenderController({
  runRender,
  outputDir,
  logger = null,
} = {}) {
  const directory = outputDir || path.join(process.cwd(), ".render-output");
  let current = { status: "idle", id: null, message: null, file: null };
  let chain = Promise.resolve();

  function view() {
    return {
      status: current.status,
      id: current.id,
      message: current.status === "failure" ? current.message : null,
    };
  }

  return {
    status: () => view(),
    resultFile() {
      if (current.status !== "success" || !isSafeResultPath(directory, current.file)) return null;
      return path.resolve(current.file);
    },
    start(spec) {
      if (!spec || spec.schemaVersion !== "storyboard-video-spec-1") {
        return { ok: false, kind: "invalid-request", httpStatus: 400 };
      }
      if (current.status === "running") return { ok: false, kind: "render-busy", httpStatus: 409 };
      const id = randomUUID();
      current = { status: "running", id, message: null, file: null };
      const output = path.join(directory, "current.mp4");
      const execute = runRender || defaultRunRender;
      chain = chain.then(async () => {
        if (current.id !== id) return;
        const temporary = path.join(directory, `${id}.mp4`);
        try {
          await mkdir(directory, { recursive: true });
          await execute(spec, temporary);
          await rename(temporary, output);
          if (current.id === id) current = { status: "success", id, message: null, file: output };
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {});
          const message = safeRenderMessage(error);
          logger?.error?.({
            event: "render",
            id,
            detail: String(error?.detail || error?.message || message).slice(0, 2000),
          });
          if (current.id === id) current = { status: "failure", id, message, file: null };
        }
      });
      return { ok: true, status: "running", id };
    },
  };
}

async function defaultRunRender(spec, outputFile) {
  const specFile = `${outputFile}.spec.json`;
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(specFile, JSON.stringify(spec));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [renderScript, specFile, outputFile], {
        cwd: remotionRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      child.on("error", (error) => {
        const wrapped = new Error("Не удалось собрать видео.");
        wrapped.publicMessage = "Локальный рендер Remotion недоступен в этом процессе.";
        wrapped.detail = error.message;
        reject(wrapped);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const wrapped = new Error("Не удалось собрать видео.");
        wrapped.publicMessage = stderr.includes("Cannot find package")
          ? "Локальный рендер Remotion недоступен в этом процессе."
          : "Не удалось собрать видео.";
        wrapped.detail = stderr;
        reject(wrapped);
      });
    });
  } finally {
    await rm(specFile, { force: true }).catch(() => {});
  }
}
