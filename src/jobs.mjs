// Job lifecycle, background worker spawning, and progress logging.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { appendLogLine as fsAppendLogLine, ensureDir } from "./fs.mjs";
import {
  claimJobTerminal,
  generateJobId,
  isTerminalJobStatus,
  listJobs,
  patchJobIfActive,
  resolveJobFile,
  resolveJobLogFile,
  resolveJobsDir,
  upsertJob,
  writeJobFile,
} from "./state.mjs";
import { terminateProcessTree } from "./process.mjs";

export const SESSION_ID_ENV = "USE_GROK_SESSION_ID";

/**
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Create a fresh job record.
 * @param {object} base
 * @param {object} options
 * @returns {object}
 */
export function createJobRecord(base, options = {}) {
  const now = nowIso();
  const workspaceRoot = options.workspaceRoot;
  const jobId = base.id ?? generateJobId(base.kind ?? "run");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  return {
    id: jobId,
    kind: base.kind ?? "task",
    kindLabel: base.kindLabel ?? "run",
    title: base.title ?? "Grok run",
    summary: base.summary ?? "",
    status: base.status ?? "queued",
    phase: base.phase ?? "queued",
    workspaceRoot,
    model: options.model ?? null,
    effort: options.effort ?? null,
    write: options.write ?? false,
    threadId: options.threadId ?? null,
    pid: null,
    agentPid: null,
    bridgePid: null,
    logFile,
    result: null,
    rendered: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    sessionId: process.env[SESSION_ID_ENV] ?? null,
    ...base,
  };
}

/**
 * Create a log file for a job and return its path.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @param {string} title
 * @returns {string}
 */
export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  ensureDir(path.dirname(logFile));
  fs.writeFileSync(logFile, `# ${title}\n\n`, "utf8");
  return logFile;
}

/**
 * Append a line to a log file.
 * @param {string} logFile
 * @param {string} message
 */
export function appendLogLine(logFile, message) {
  fsAppendLogLine(logFile, `${message}\n`);
}

/**
 * Append a titled block to a log file.
 * @param {string} logFile
 * @param {string} title
 * @param {string} body
 */
export function appendLogBlock(logFile, title, body) {
  appendLogLine(logFile, `\n## ${title}\n\n${body}\n`);
}

/**
 * Create a progress reporter that writes to stderr and optionally a log file.
 * @param {object} options
 * @param {NodeJS.WriteStream} [options.stderr]
 * @param {string} [options.logFile]
 * @param {(event: string, data?: any) => void} [options.onEvent]
 * @returns {{ log: (msg: string) => void }}
 */
export function createProgressReporter(options = {}) {
  const stderr = options.stderr ?? process.stderr;
  const logFile = options.logFile;
  return {
    log(message) {
      stderr.write(`${message}\n`);
      if (logFile) {
        appendLogLine(logFile, message);
      }
      if (options.onEvent) {
        options.onEvent("log", message);
      }
    },
  };
}

/**
 * Create a job progress updater that patches job metadata periodically.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createJobProgressUpdater(workspaceRoot, jobId) {
  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        patchJobIfActive(workspaceRoot, jobId, {});
      }, 5000);
      // Do not hold the process open just for the updater.
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * Resolve the list of PIDs to kill for a job.
 * @param {any} job
 * @returns {number[]}
 */
export function resolveJobKillTargets(job) {
  const targets = [];
  for (const key of ["agentPid", "bridgePid", "companionPid", "pid"]) {
    const value = job?.[key];
    if (typeof value === "number" && value > 0) {
      targets.push(value);
    }
  }
  return [...new Set(targets)];
}

/**
 * Run a job under tracking: patch to running, execute runner, claim terminal status.
 * @param {any} job
 * @param {(reporter: { log: (msg: string) => void }) => Promise<{ status: number, rawOutput: string }>} runner
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export async function runTrackedJob(job, runner, options = {}) {
  const workspaceRoot = job.workspaceRoot;
  const jobId = job.id;

  const started = nowIso();
  upsertJob(workspaceRoot, {
    id: jobId,
    status: "running",
    phase: "running",
    startedAt: started,
  });

  const updater = createJobProgressUpdater(workspaceRoot, jobId);
  updater.start();

  const logFile = job.logFile;
  const reporter = createProgressReporter({ logFile });

  try {
    const result = await runner(reporter);
    const completedAt = nowIso();
    const terminal = {
      id: jobId,
      status: result.status === 0 ? "completed" : "failed",
      phase: result.status === 0 ? "done" : "failed",
      result,
      completedAt,
    };
    upsertJob(workspaceRoot, terminal);
    return { ...job, ...terminal };
  } catch (error) {
    const completedAt = nowIso();
    const terminal = {
      id: jobId,
      status: "failed",
      phase: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      completedAt,
    };
    upsertJob(workspaceRoot, terminal);
    throw error;
  } finally {
    updater.stop();
  }
}

/**
 * Enqueue a background job by writing its request and spawning a detached worker.
 * @param {string} cwd
 * @param {any} job
 * @param {object} request
 * @param {object} [options]
 * @returns {any}
 */
export function enqueueBackgroundJob(cwd, job, request, options = {}) {
  const workspaceRoot = job.workspaceRoot;
  ensureDir(resolveJobsDir(workspaceRoot));

  // Store the full job plus the request the worker needs.
  const full = { ...job, request };
  writeJobFile(workspaceRoot, job.id, full);
  createJobLogFile(workspaceRoot, job.id, job.title);
  upsertJob(workspaceRoot, job);

  const child = spawnDetachedRunWorker(cwd, job.id, options);

  patchJobIfActive(workspaceRoot, job.id, {
    bridgePid: child.pid,
  });

  return { ...job, bridgePid: child.pid };
}

/**
 * Spawn a detached run-worker process.
 * @param {string} cwd
 * @param {string} jobId
 * @param {object} [options]
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnDetachedRunWorker(cwd, jobId, options = {}) {
  // Spawn the package entrypoint (which self-executes main), not src/cli.mjs.
  // fileURLToPath keeps paths with spaces intact (URL.pathname would %-encode them).
  const scriptPath = options.scriptPath ?? fileURLToPath(new URL("../bin/use-grok.mjs", import.meta.url));
  const child = spawn(process.execPath, [scriptPath, "run-worker", "--cwd", cwd, "--job-id", jobId], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, [SESSION_ID_ENV]: process.env[SESSION_ID_ENV] ?? "" },
  });
  child.unref();
  return child;
}

/**
 * Load a job file written by enqueueBackgroundJob.
 * @param {string} cwd
 * @param {string} jobId
 * @returns {any|undefined}
 */
export function loadBackgroundJob(cwd, jobId) {
  const file = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Stop an active job by killing its tracked process tree.
 * @param {string} cwd
 * @param {any} job
 * @returns {Promise<any>}
 */
export async function stopJob(cwd, job) {
  for (const pid of resolveJobKillTargets(job)) {
    try {
      await terminateProcessTree(pid);
    } catch {
      // ignore
    }
  }
  claimJobTerminal(cwd, job.id, "cancelled", {
    errorMessage: "Stopped by user.",
    phase: "cancelled",
    completedAt: nowIso(),
  });
  return loadStateJob(cwd, job.id);
}

/**
 * Load a job from the state index.
 * @param {string} cwd
 * @param {string} jobId
 * @returns {any|undefined}
 */
function loadStateJob(cwd, jobId) {
  return listJobs(cwd).find((j) => j.id === jobId);
}
