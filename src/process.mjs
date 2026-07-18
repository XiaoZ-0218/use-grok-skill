// Process spawning and cross-platform process-tree termination.

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Run a command synchronously and return a normalized result.
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @param {string} [options.input]
 * @param {number} [options.timeoutMs=120000]
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout: options.timeoutMs ?? 120000,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    // Surface spawn errors (ENOENT, timeout, maxBuffer) instead of failing silently.
    stderr: (result.stderr ?? "") + (result.error ? `\n${result.error.message}` : ""),
  };
}

/**
 * Run a command asynchronously without blocking the event loop.
 * Suitable for long-running commands (e.g. headless agent invocations).
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @param {number} [options.timeoutMs=120000]
 * @param {number} [options.maxOutputChars] - cap per stream to bound memory
 * @returns {Promise<{ status: number|null, stdout: string, stderr: string }>}
 */
export function runCommandAsync(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxOutputChars = options.maxOutputChars ?? 16_000_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      stderr += `\nCommand timed out after ${timeoutMs}ms`;
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone.
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < maxOutputChars) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < maxOutputChars) stderr += chunk;
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => {
      finish(timedOut && code === 0 ? null : code);
    });
  });
}

/**
 * Run a command and return stdout. Throws a formatted error on non-zero exit.
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @returns {string}
 */
export function runCommandChecked(command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    throw new Error(formatCommandFailure({ command, args, result }));
  }
  return result.stdout;
}

/**
 * Check whether a binary is available and optionally parse its version output.
 * @param {string} command
 * @param {string[]} [versionArgs]
 * @param {object} [options]
 * @returns {{ available: boolean, detail?: string }}
 */
export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, { ...options, timeoutMs: options.timeoutMs ?? 10000 });
  if (result.status !== 0) {
    return { available: false };
  }
  const detail = result.stdout.trim() || result.stderr.trim();
  return { available: true, detail };
}

/**
 * Format a command failure for human consumption.
 * @param {object} params
 * @param {string} params.command
 * @param {string[]} params.args
 * @param {{ status: number|null, stdout: string, stderr: string }} params.result
 * @returns {string}
 */
export function formatCommandFailure({ command, args, result }) {
  const cmd = [command, ...args].join(" ");
  let message = `Command failed with status ${result.status}: ${cmd}`;
  const stderr = result.stderr.trim();
  if (stderr) {
    message += `\n${stderr}`;
  }
  return message;
}

/**
 * Terminate a process tree. Cross-platform: Windows uses taskkill, Unix uses signals.
 * @param {number} pid
 * @param {object} [options]
 * @param {number} [options.signal="SIGTERM"]
 */
export function terminateProcessTree(pid, options = {}) {
  if (!pid || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  // Try process-group kill first so detached children are included.
  try {
    process.kill(-pid, options.signal ?? "SIGTERM");
  } catch {
    try {
      process.kill(pid, options.signal ?? "SIGTERM");
    } catch {
      // Process may already be gone.
    }
  }

  // Give it a moment, then SIGKILL if still alive.
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
