// Per-workspace JSON state store with simple file locking.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

import { ensureDir, readJsonFile, writeJsonFile } from "./fs.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

export const STATE_VERSION = 1;

const STATE_DIR_ENV = "USE_GROK_STATE_DIR";
const DEFAULT_STATE_BASE = "use-grok-runs";
const MAX_JOBS = 50;

/**
 * Generate a short slug from a directory path for state directory naming.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function workspaceSlug(workspaceRoot) {
  const base = path.basename(workspaceRoot) || "workspace";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

/**
 * Generate a short hash from a workspace root for unique state directory naming.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function workspaceHash(workspaceRoot) {
  return crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
}

/**
 * Resolve the state directory for a workspace.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const base = process.env[STATE_DIR_ENV] || path.join(os.tmpdir(), DEFAULT_STATE_BASE);
  const slug = workspaceSlug(workspaceRoot);
  const hash = workspaceHash(workspaceRoot);
  return path.join(base, `${slug}-${hash}`);
}

/**
 * Resolve the state.json path.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

/**
 * Resolve the jobs directory.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), "jobs");
}

/**
 * Resolve a per-job JSON file path.
 * @param {string} cwd
 * @param {string} jobId
 * @returns {string}
 */
export function resolveJobFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

/**
 * Resolve a per-job log file path.
 * @param {string} cwd
 * @param {string} jobId
 * @returns {string}
 */
export function resolveJobLogFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

/**
 * Load state.json, returning a default if it does not exist.
 * @param {string} cwd
 * @returns {{ version: number, jobs: any[] }}
 */
export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  const existing = readJsonFile(stateFile);
  if (existing) {
    return { version: existing.version ?? STATE_VERSION, jobs: existing.jobs ?? [] };
  }
  return { version: STATE_VERSION, jobs: [] };
}

/**
 * Save state.json atomically.
 * @param {string} cwd
 * @param {{ version: number, jobs: any[] }} state
 */
export function saveState(cwd, state) {
  const stateFile = resolveStateFile(cwd);
  ensureDir(path.dirname(stateFile));
  writeJsonFile(stateFile, state);
}

/**
 * Acquire a simple exclusive lock using an atomic mkdir, run fn, then release.
 * Falls back to a short retry loop if the lock is held.
 * @param {string} cwd
 * @param {() => T} fn
 * @returns {T}
 * @template T
 */
export function withStateLock(cwd, fn) {
  const stateFile = resolveStateFile(cwd);
  ensureDir(path.dirname(stateFile));
  const lockDir = `${stateFile}.lock`;

  const start = Date.now();
  const maxWait = 10000;
  const retryDelay = 10;

  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      break;
    } catch {
      if (Date.now() - start > maxWait) {
        throw new Error(`Timed out waiting for state lock: ${lockDir}`);
      }
      // Minimal busy-wait; acceptable for CLI use.
      const now = Date.now();
      while (Date.now() - now < retryDelay) {
        // spin
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // ignore
    }
  }
}

/**
 * Update state inside a lock.
 * @param {string} cwd
 * @param {(state: { version: number, jobs: any[] }) => void} mutate
 */
export function updateState(cwd, mutate) {
  withStateLock(cwd, () => {
    const state = loadState(cwd);
    mutate(state);
    saveState(cwd, state);
  });
}

/**
 * Check whether a job status is terminal.
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminalJobStatus(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Generate a short unique job id with a prefix.
 * @param {string} prefix
 * @returns {string}
 */
export function generateJobId(prefix) {
  const rand = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${rand}`;
}

/**
 * Read a job file.
 * @param {string} jobFile
 * @returns {any|undefined}
 */
export function readJobFile(jobFile) {
  return readJsonFile(jobFile);
}

/**
 * Write a job file atomically.
 * @param {string} cwd
 * @param {string} jobId
 * @param {any} payload
 */
export function writeJobFile(cwd, jobId, payload) {
  const file = resolveJobFile(cwd, jobId);
  ensureDir(path.dirname(file));
  writeJsonFile(file, payload);
}

/**
 * Upsert a job into the state index, pruning old jobs if needed.
 * @param {string} cwd
 * @param {any} jobPatch
 */
export function upsertJob(cwd, jobPatch) {
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((j) => j.id === jobPatch.id);
    const now = new Date().toISOString();
    const next = { ...(index >= 0 ? state.jobs[index] : {}), ...jobPatch, updatedAt: now };
    if (index >= 0) {
      state.jobs[index] = next;
    } else {
      state.jobs.push(next);
    }
    // Prune oldest non-running jobs if we exceed MAX_JOBS.
    if (state.jobs.length > MAX_JOBS) {
      const runningIds = new Set(state.jobs.filter((j) => !isTerminalJobStatus(j.status)).map((j) => j.id));
      const sorted = [...state.jobs].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
      const toRemove = [];
      for (const j of sorted) {
        if (state.jobs.length - toRemove.length <= MAX_JOBS) break;
        if (!runningIds.has(j.id)) {
          toRemove.push(j.id);
        }
      }
      state.jobs = state.jobs.filter((j) => !toRemove.includes(j.id));
    }
  });
}

/**
 * List jobs from state.
 * @param {string} cwd
 * @returns {any[]}
 */
export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

/**
 * Claim a terminal status for a job, failing silently if already terminal.
 * @param {string} cwd
 * @param {string} jobId
 * @param {string} nextStatus
 * @param {any} patch
 */
export function claimJobTerminal(cwd, jobId, nextStatus, patch) {
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((j) => j.id === jobId);
    if (index < 0) return;
    const job = state.jobs[index];
    if (isTerminalJobStatus(job.status)) return;
    state.jobs[index] = { ...job, ...patch, status: nextStatus, updatedAt: new Date().toISOString() };
  });
}

/**
 * Patch a job if it is still active.
 * @param {string} cwd
 * @param {string} jobId
 * @param {any} patch
 */
export function patchJobIfActive(cwd, jobId, patch) {
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((j) => j.id === jobId);
    if (index < 0) return;
    const job = state.jobs[index];
    if (isTerminalJobStatus(job.status)) return;
    state.jobs[index] = { ...job, ...patch, updatedAt: new Date().toISOString() };
  });
}
