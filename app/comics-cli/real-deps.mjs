import { spawn, execFile as execFileCallback } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const execFileAsync = promisify(execFileCallback);

function exitCode(error) {
  if (Number.isInteger(error?.code)) return error.code;
  if (Number.isInteger(error?.status)) return error.status;
  return 1;
}

export function createRealDependencies({ packageRoot, env = process.env } = {}) {
  return {
    packageRoot,
    env,
    callerCwd: process.cwd(),
    nodeVersion: process.versions.node,
    randomBytes,
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async execFile(file, args, options = {}) {
      try {
        const { stdout, stderr } = await execFileAsync(file, args, {
          cwd: options.cwd,
          env: options.env ?? env,
          encoding: "utf8",
          timeout: options.timeout ?? 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { code: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "EACCES") {
          return { code: 127, stdout: "", stderr: `${file} is unavailable` };
        }
        return {
          code: exitCode(error),
          stdout: error?.stdout?.toString?.() ?? "",
          stderr: error?.stderr?.toString?.() ?? "",
        };
      }
    },
    spawnDetached(file, args, { cwd, env: childEnv, logPath }) {
      const fd = openSync(logPath, "a");
      const child = spawn(file, args, {
        cwd,
        env: childEnv,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      closeSync(fd);
      child.unref();
      let exit = null;
      const listeners = [];
      child.on("exit", (code, signal) => {
        exit = { code, signal };
        for (const listener of listeners) listener(exit);
      });
      return {
        pid: child.pid,
        onExit(listener) {
          if (exit) listener(exit);
          else listeners.push(listener);
        },
      };
    },
    async describeProcess(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return { alive: false, command: null };
      try {
        const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-ww", "-o", "args="], {
          encoding: "utf8",
          timeout: 2000,
        });
        const command = stdout.trim();
        if (!command) return { alive: false, command: null };
        return { alive: true, command };
      } catch {
        return { alive: false, command: null };
      }
    },
    signalProcess(pid, signal) {
      try {
        process.kill(pid, signal);
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error?.code ?? null };
      }
    },
    httpGet(url, { timeout = 2000 } = {}) {
      return new Promise((resolve, reject) => {
        const req = httpRequest(url, { method: "GET", timeout }, (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        });
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.on("error", reject);
        req.end();
      });
    },
    portOpen(port) {
      return new Promise((resolve) => {
        const socket = netConnect({ host: "127.0.0.1", port });
        const finish = (open) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(open);
        };
        socket.setTimeout(200);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
      });
    },
    interactivePsql(args, psqlEnv) {
      return new Promise((resolve) => {
        const child = spawn("psql", args, { stdio: "inherit", env: psqlEnv });
        child.on("exit", (code, signal) => {
          if (signal) resolve(1);
          else resolve(code ?? 1);
        });
        child.on("error", () => resolve(127));
      });
    },
  };
}
