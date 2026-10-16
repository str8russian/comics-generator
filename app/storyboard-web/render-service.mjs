import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ID_PATTERN } from "./project-scope.mjs";

const remotionRoot = fileURLToPath(new URL("../../prototypes/remotion-rough/", import.meta.url));
const renderScript = path.join(remotionRoot, "tools", "render-spec.mjs");

export function isSafeResultPath(directory, file, projectId) {
  if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) return false;
  if (typeof file !== "string" || !file) return false;
  return path.resolve(file) === path.resolve(directory, projectId, "current.mp4");
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
  const currents = new Map();
  let chain = Promise.resolve();

  function idle() {
    return {
      status: "idle",
      id: null,
      message: null,
      file: null,
      transition: null,
      overlapFrames: null,
      totalDurationFrames: null,
      nominalDurationFrames: null,
    };
  }

  function slot(projectId) {
    if (!currents.has(projectId)) currents.set(projectId, idle());
    return currents.get(projectId);
  }

  function view(projectId) {
    const current = slot(projectId);
    return {
      status: current.status,
      id: current.id,
      message: current.status === "failure" ? current.message : null,
      transition: current.transition,
      overlapFrames: current.overlapFrames,
      totalDurationFrames: current.totalDurationFrames,
      nominalDurationFrames: current.nominalDurationFrames,
    };
  }

  return {
    status: (projectId) => view(projectId),
    readyProjectIds() {
      return [...currents.entries()]
        .filter(([, current]) => current.status === "success")
        .map(([projectId]) => projectId);
    },
    resultFile(projectId) {
      const current = slot(projectId);
      if (current.status !== "success" || !isSafeResultPath(directory, current.file, projectId)) return null;
      return path.resolve(current.file);
    },
    start(spec, hooks = {}, projectId) {
      if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) {
        return { ok: false, kind: "invalid-request", httpStatus: 400 };
      }
      if (!spec || spec.schemaVersion !== "storyboard-video-spec-1") {
        return { ok: false, kind: "invalid-request", httpStatus: 400 };
      }
      if (slot(projectId).status === "running") return { ok: false, kind: "render-busy", httpStatus: 409 };
      const id = randomUUID();
      const transition = spec.project?.exportTransition?.mode || "hard-cut";
      const overlapFrames = spec.project?.exportTransition?.overlapFrames ?? 0;
      const timing = {
        transition,
        overlapFrames,
        totalDurationFrames: spec.project?.totalDurationFrames ?? null,
        nominalDurationFrames: spec.project?.nominalDurationFrames ?? null,
      };
      currents.set(projectId, { status: "running", id, message: null, file: null, ...timing });
      const projectDir = path.join(directory, projectId);
      const output = path.join(projectDir, "current.mp4");
      const execute = runRender || defaultRunRender;
      let settled = false;
      chain = chain.then(async () => {
        if (slot(projectId).id !== id) return;
        await hooks.onStart?.({ id, spec, projectId });
        if (slot(projectId).id !== id || settled) return;
        const temporary = path.join(projectDir, `${id}.mp4`);
        let outcome = "success";
        try {
          await mkdir(projectDir, { recursive: true });
          await execute(spec, temporary);
          await rename(temporary, output);
          if (slot(projectId).id === id) {
            currents.set(projectId, { status: "success", id, message: null, file: output, ...timing });
          }
        } catch (error) {
          outcome = "failure";
          await rm(temporary, { force: true }).catch(() => {});
          const message = safeRenderMessage(error);
          logger?.error?.({
            event: "render",
            id,
            detail: String(error?.detail || error?.message || message).slice(0, 2000),
          });
          if (slot(projectId).id === id) {
            currents.set(projectId, { status: "failure", id, message, file: null, ...timing });
          }
        }
        if (settled || slot(projectId).id !== id) return;
        settled = true;
        await hooks.onTerminal?.({ id, status: outcome, spec, projectId });
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
