// CLI subcommand dispatcher and orchestration for use-grok.

import fs from "node:fs";
import process from "node:process";

import { parseArgs } from "./args.mjs";
import { ensureAbsolutePath, readJsonFile } from "./fs.mjs";
import {
  buildReviewPrompt,
  getGrokAuthStatus,
  getGrokAvailability,
  parseStructuredOutput,
  resolveGrokBinary,
  resolveSchemaPath,
  runAsk,
  runCritique,
  runReview,
  runTask,
  schemaInstructionsFromPath,
} from "./grok.mjs";
import {
  collectReviewContext,
  ensureGitRepository,
  resolveReviewTarget,
} from "./git.mjs";
import {
  createJobLogFile,
  createJobRecord,
  enqueueBackgroundJob,
  loadBackgroundJob,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV,
  stopJob,
} from "./jobs.mjs";
import { loadPromptTemplate, interpolateTemplate, resolvePackageRoot } from "./prompts.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderNativeReviewResult,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
} from "./render.mjs";
import {
  claimJobTerminal,
  isTerminalJobStatus,
  listJobs,
  patchJobIfActive,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
} from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const USAGE = `use-grok — Agent-agnostic bridge to the Grok Build CLI

Usage:
  use-grok check [--json]
  use-grok ask <prompt> [--model <model>] [--effort low|medium|high] [--json]
  use-grok review [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <effort>] [--json]
  use-grok critique [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <effort>] [--json] [focus...]
  use-grok run <prompt> [--background] [--write] [--model <model>] [--effort <effort>] [--json]
  use-grok runs [run-id] [--wait] [--json]
  use-grok show [run-id] [--json]
  use-grok stop [run-id] [--json]

Global flags:
  --cwd <dir>   Use the specified working directory
  --json        Output JSON for machine parsing
`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function printUsage() {
  process.stdout.write(USAGE + "\n");
}

function printError(message) {
  process.stderr.write(`Error: ${message}\n\n${USAGE}\n`);
}

function outputResult(result, options = {}) {
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (typeof result === "string") {
    process.stdout.write(result);
    if (!result.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function normalizeReasoningEffort(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) {
    return normalized;
  }
  throw new Error(`Invalid effort level: ${value}. Use low, medium, or high.`);
}

function resolveCommandCwd(flags) {
  return ensureAbsolutePath(process.cwd(), flags.cwd);
}

function resolveCommandWorkspace(flags) {
  const cwd = resolveCommandCwd(flags);
  return resolveWorkspaceRoot(cwd);
}

function commonGrokOptions(flags) {
  return {
    binary: resolveGrokBinary(),
    model: flags.model,
    effort: normalizeReasoningEffort(flags.effort),
  };
}

function collectPrompt(positionals, flags) {
  const raw = positionals.join(" ").trim();
  if (!raw) {
    throw new Error("A prompt is required.");
  }
  return raw;
}

function collectFocus(positionals) {
  return positionals.join(" ").trim() || undefined;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleCheck(args) {
  const { flags } = parseArgs(args, { booleanOptions: ["json"] });
  const cwd = resolveCommandCwd(flags);
  const binary = resolveGrokBinary();

  const node = { available: true, detail: process.version };
  const grok = getGrokAvailability(cwd, { binary });
  const auth = grok.available ? getGrokAuthStatus(cwd, { binary }) : { available: false, loggedIn: false };

  const report = {
    ready: node.available && grok.available && auth.loggedIn,
    node,
    grok,
    auth,
    sessionRuntime: {
      mode: "cli-owned",
      label: "CLI-owned runs",
      detail: "Runs are tracked by the use-grok CLI (PID + log files).",
      endpoint: null,
    },
  };

  if (flags.json) {
    outputResult(report, { json: true });
  } else {
    process.stdout.write(renderSetupReport(report));
  }
  return report.ready ? 0 : 1;
}

async function handleAsk(args) {
  const { flags, positionals } = parseArgs(args, {
    valueOptions: ["model", "effort"],
    booleanOptions: ["json"],
  });
  const cwd = resolveCommandCwd(flags);
  const prompt = collectPrompt(positionals, flags);

  const result = await runAsk(cwd, prompt, {
    ...commonGrokOptions(flags),
    json: flags.json,
  });

  if (flags.json) {
    outputResult({ status: result.status, output: result.rawOutput.trim() }, { json: true });
  } else {
    process.stdout.write(result.rawOutput);
    if (!result.rawOutput.endsWith("\n")) process.stdout.write("\n");
  }

  return result.status === 0 ? 0 : 1;
}

async function handleReview(args) {
  const { flags, positionals } = parseArgs(args, {
    valueOptions: ["base", "scope", "model", "effort"],
    booleanOptions: ["wait", "background", "json"],
  });
  const cwd = resolveCommandCwd(flags);
  ensureGitRepository(cwd);

  const target = resolveReviewTarget(cwd, { base: flags.base, scope: flags.scope });
  const context = collectReviewContext(cwd, target);
  const focus = collectFocus(positionals);

  const prompt = buildReviewPrompt({
    targetLabel: target.label,
    focusText: focus,
    reviewInput: context.input,
  });

  const title = `Review ${target.label}`;

  if (flags.background) {
    const workspaceRoot = resolveCommandWorkspace(flags);
    const job = createJobRecord(
      {
        kind: "review",
        kindLabel: "review",
        title,
        summary: target.label,
        status: "queued",
        phase: "queued",
      },
      { workspaceRoot, ...commonGrokOptions(flags) }
    );
    createJobLogFile(workspaceRoot, job.id, title);
    enqueueBackgroundJob(cwd, job, { kind: "review", prompt, options: commonGrokOptions(flags) });
    if (!flags.wait) {
      outputResult({ queued: true, runId: job.id, status: "queued" }, { json: flags.json });
      return 0;
    }
    const finalJob = await waitForJobTerminal(cwd, job.id);
    const finalOutput = finalJob.result?.rawOutput ?? "";
    if (flags.json) {
      outputResult(
        { status: finalJob.status === "completed" ? 0 : 1, runId: job.id, output: finalOutput.trim() },
        { json: true }
      );
    } else {
      process.stdout.write(renderNativeReviewResult(finalOutput));
    }
    return finalJob.status === "completed" ? 0 : 1;
  }

  const result = await runReview(cwd, prompt, commonGrokOptions(flags));
  const output = result.rawOutput;

  if (flags.json) {
    outputResult({ status: result.status, output: output.trim() }, { json: true });
  } else {
    process.stdout.write(renderNativeReviewResult(output));
  }

  return result.status === 0 ? 0 : 1;
}

async function handleCritique(args) {
  const { flags, positionals } = parseArgs(args, {
    valueOptions: ["base", "scope", "model", "effort"],
    booleanOptions: ["wait", "background", "json"],
  });
  const cwd = resolveCommandCwd(flags);
  ensureGitRepository(cwd);

  const target = resolveReviewTarget(cwd, { base: flags.base, scope: flags.scope });
  const context = collectReviewContext(cwd, target);
  const focus = collectFocus(positionals);

  const packageRoot = resolvePackageRoot(import.meta.url);
  const critiqueTemplate = loadPromptTemplate(packageRoot, "critique.md");
  const schemaPath = resolveSchemaPath("review-output.schema.json");
  const schemaInstructions = schemaInstructionsFromPath(schemaPath);

  const prompt = interpolateTemplate(critiqueTemplate, {
    TARGET_LABEL: target.label,
    USER_FOCUS: focus ?? "general design and risk assessment",
    REVIEW_COLLECTION_GUIDANCE: schemaInstructions,
    REVIEW_INPUT: context.input,
  });

  const title = `Critique ${target.label}`;

  if (flags.background) {
    const workspaceRoot = resolveCommandWorkspace(flags);
    const job = createJobRecord(
      {
        kind: "critique",
        kindLabel: "critique",
        title,
        summary: target.label,
        status: "queued",
        phase: "queued",
      },
      { workspaceRoot, ...commonGrokOptions(flags) }
    );
    createJobLogFile(workspaceRoot, job.id, title);
    enqueueBackgroundJob(cwd, job, {
      kind: "critique",
      prompt,
      options: { ...commonGrokOptions(flags), jsonSchema: schemaPath },
    });
    if (!flags.wait) {
      outputResult({ queued: true, runId: job.id, status: "queued" }, { json: flags.json });
      return 0;
    }
    const finalJob = await waitForJobTerminal(cwd, job.id);
    const finalOutput = finalJob.result?.rawOutput ?? "";
    const finalParsed = parseStructuredOutput(finalOutput, null);
    if (flags.json) {
      outputResult(
        {
          status: finalJob.status === "completed" ? 0 : 1,
          runId: job.id,
          parsed: finalParsed,
          output: finalOutput.trim(),
        },
        { json: true }
      );
    } else {
      process.stdout.write(renderReviewResult(finalParsed));
    }
    return finalJob.status === "completed" ? 0 : 1;
  }

  const result = await runCritique(cwd, prompt, {
    ...commonGrokOptions(flags),
    jsonSchema: schemaPath,
  });

  const parsed = parseStructuredOutput(result.rawOutput, null);

  if (flags.json) {
    outputResult({ status: result.status, parsed, output: result.rawOutput.trim() }, { json: true });
  } else {
    process.stdout.write(renderReviewResult(parsed));
  }

  return result.status === 0 ? 0 : 1;
}

async function handleRun(args) {
  const { flags, positionals } = parseArgs(args, {
    valueOptions: ["model", "effort"],
    booleanOptions: ["background", "write", "json"],
  });
  const cwd = resolveCommandCwd(flags);
  const prompt = collectPrompt(positionals, flags);

  const title = `Run: ${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}`;

  if (flags.background) {
    const workspaceRoot = resolveCommandWorkspace(flags);
    const job = createJobRecord(
      {
        kind: "task",
        kindLabel: "delegate",
        title,
        summary: prompt.slice(0, 120),
        status: "queued",
        phase: "queued",
      },
      { workspaceRoot, write: flags.write, ...commonGrokOptions(flags) }
    );
    createJobLogFile(workspaceRoot, job.id, title);
    enqueueBackgroundJob(cwd, job, {
      kind: "run",
      prompt,
      options: { write: flags.write, ...commonGrokOptions(flags) },
    });
    outputResult({ queued: true, runId: job.id, status: "queued" }, { json: flags.json });
    return 0;
  }

  const workspaceRoot = resolveCommandWorkspace(flags);
  const job = createJobRecord(
    {
      kind: "task",
      kindLabel: "delegate",
      title,
      summary: prompt.slice(0, 120),
      status: "running",
      phase: "running",
    },
    { workspaceRoot, write: flags.write, ...commonGrokOptions(flags) }
  );

  const finalJob = await runTrackedJob(job, async () => {
    const result = await runTask(cwd, prompt, {
      write: flags.write,
      ...commonGrokOptions(flags),
    });
    return result;
  });

  if (flags.json) {
    outputResult(
      {
        status: finalJob.status === "completed" ? 0 : 1,
        runId: finalJob.id,
        output: finalJob.result?.rawOutput?.trim() ?? "",
      },
      { json: true }
    );
  } else {
    process.stdout.write(renderTaskResult(finalJob.result));
  }

  return finalJob.status === "completed" ? 0 : 1;
}

async function handleRuns(args) {
  const { flags, positionals } = parseArgs(args, {
    valueOptions: ["timeout-ms", "poll-interval-ms"],
    booleanOptions: ["wait", "all", "json"],
  });
  const cwd = resolveCommandCwd(flags);
  const workspaceRoot = resolveCommandWorkspace(flags);
  const sessionId = process.env[SESSION_ID_ENV];

  let jobId = positionals[0];

  if (jobId && flags.wait) {
    const deadline = Date.now() + (Number(flags["timeout-ms"]) || 300000);
    const interval = Number(flags["poll-interval-ms"]) || 1000;
    while (Date.now() < deadline) {
      const job = findJob(cwd, jobId, sessionId);
      if (!job) {
        throw new Error(`Run not found: ${jobId}`);
      }
      if (isTerminalJobStatus(job.status)) {
        outputResult({ runId: job.id, status: job.status, job }, { json: flags.json });
        return job.status === "completed" ? 0 : 1;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timed out waiting for run ${jobId}`);
  }

  let jobs = listJobs(cwd);
  if (!flags.all && sessionId) {
    jobs = jobs.filter((j) => j.sessionId === sessionId);
  }

  if (jobId) {
    const job = jobs.find((j) => j.id === jobId || j.id.startsWith(jobId));
    if (!job) {
      throw new Error(`Run not found: ${jobId}`);
    }
    if (flags.json) {
      outputResult({ runId: job.id, status: job.status, job }, { json: true });
    } else {
      process.stdout.write(renderJobStatusReport(job));
    }
    return 0;
  }

  if (flags.json) {
    outputResult({ jobs }, { json: true });
  } else {
    process.stdout.write(renderStatusReport({ jobs }));
  }
  return 0;
}

async function handleShow(args) {
  const { flags, positionals } = parseArgs(args, { booleanOptions: ["json"] });
  const cwd = resolveCommandCwd(flags);
  const sessionId = process.env[SESSION_ID_ENV];
  const jobId = positionals[0];

  const job = findJob(cwd, jobId, sessionId);
  if (!job) {
    throw new Error(`Run not found: ${jobId ?? "(latest)"}`);
  }

  const stored = readJsonFile(resolveJobFile(cwd, job.id));

  if (flags.json) {
    outputResult({ runId: job.id, status: job.status, job, stored }, { json: true });
  } else {
    process.stdout.write(renderStoredJobResult(job, stored));
  }

  return 0;
}

async function handleStop(args) {
  const { flags, positionals } = parseArgs(args, { booleanOptions: ["json"] });
  const cwd = resolveCommandCwd(flags);
  const sessionId = process.env[SESSION_ID_ENV];
  const jobId = positionals[0];

  const job = findJob(cwd, jobId, sessionId, { requireActive: true });
  if (!job) {
    throw new Error(`No active run found: ${jobId ?? "(latest)"}`);
  }

  const stopped = await stopJob(cwd, job);
  if (flags.json) {
    outputResult({ status: 0, runId: job.id, stopped: true }, { json: true });
  } else {
    outputResult(renderCancelReport(stopped), { json: false });
  }
  return 0;
}

async function handleRunWorker(args) {
  const { flags } = parseArgs(args, {
    valueOptions: ["cwd", "job-id"],
    booleanOptions: [],
  });

  if (!flags["job-id"]) {
    throw new Error("run-worker requires --job-id");
  }

  const cwd = ensureAbsolutePath(process.cwd(), flags.cwd);
  const jobId = flags["job-id"];
  const stored = loadBackgroundJob(cwd, jobId);

  if (!stored) {
    throw new Error(`Background job file not found: ${jobId}`);
  }

  const { request } = stored;
  const workspaceRoot = stored.workspaceRoot;
  const logFile = stored.logFile ?? resolveJobLogFile(cwd, jobId);

  patchJobIfActive(workspaceRoot, jobId, {
    bridgePid: process.pid,
    status: "running",
    phase: "running",
    startedAt: nowIso(),
  });

  try {
    let result;
    if (request.kind === "review") {
      result = await runReview(cwd, request.prompt, request.options);
    } else if (request.kind === "critique") {
      result = await runCritique(cwd, request.prompt, request.options);
    } else {
      result = await runTask(cwd, request.prompt, request.options);
    }

    const completedAt = nowIso();
    const terminal = {
      status: result.status === 0 ? "completed" : "failed",
      phase: result.status === 0 ? "done" : "failed",
      result: { status: result.status, rawOutput: result.rawOutput, stderr: result.stderr },
      completedAt,
    };

    const rendered = request.kind === "critique"
      ? renderReviewResult(parseStructuredOutput(result.rawOutput, null))
      : renderTaskResult(result);

    upsertJob(workspaceRoot, { id: jobId, ...terminal, rendered });

    if (logFile) {
      fs.appendFileSync(logFile, `\n## Output\n\n${result.stdout}\n`, "utf8");
    }

    return result.status === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    claimJobTerminal(workspaceRoot, jobId, "failed", {
      errorMessage: message,
      phase: "failed",
      completedAt: nowIso(),
    });
    if (logFile) {
      fs.appendFileSync(logFile, `\n## Error\n\n${message}\n`, "utf8");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Job lookup helper
// ---------------------------------------------------------------------------

/**
 * Poll the state store until a job reaches a terminal status.
 * @param {string} cwd
 * @param {string} jobId
 * @param {object} [options]
 * @param {number} [options.timeoutMs=600000]
 * @param {number} [options.intervalMs=1000]
 * @returns {Promise<any>}
 */
async function waitForJobTerminal(cwd, jobId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 600000;
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = listJobs(cwd).find((j) => j.id === jobId);
    if (job && isTerminalJobStatus(job.status)) {
      return job;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for run ${jobId}`);
}

function findJob(cwd, jobId, sessionId, options = {}) {
  const jobs = listJobs(cwd);

  if (jobId) {
    const match = jobs.find((j) => j.id === jobId || j.id.startsWith(jobId));
    return match;
  }

  // Without an explicit id, prefer the latest job in the current session.
  let candidates = jobs;
  if (sessionId) {
    candidates = jobs.filter((j) => j.sessionId === sessionId);
  }

  if (options.requireActive) {
    candidates = candidates.filter((j) => !isTerminalJobStatus(j.status));
  }

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    return 0;
  }

  const subcommand = argv[0];
  const subArgs = argv.slice(1);

  try {
    switch (subcommand) {
      case "check":
        return await handleCheck(subArgs);
      case "ask":
        return await handleAsk(subArgs);
      case "review":
        return await handleReview(subArgs);
      case "critique":
        return await handleCritique(subArgs);
      case "run":
        return await handleRun(subArgs);
      case "runs":
        return await handleRuns(subArgs);
      case "show":
        return await handleShow(subArgs);
      case "stop":
        return await handleStop(subArgs);
      case "run-worker":
        return await handleRunWorker(subArgs);
      default:
        printError(`Unknown command: ${subcommand}`);
        return 2;
    }
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
