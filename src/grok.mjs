// Grok CLI invocation, availability/auth probes, and structured output parsing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand, runCommandAsync, binaryAvailable } from "./process.mjs";
import { safeReadFile } from "./fs.mjs";

const GROK_BINARY_ENV = "GROK_BINARY";

/**
 * Resolve the grok executable path.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveGrokBinary(env = process.env) {
  return env[GROK_BINARY_ENV] || "grok";
}

/**
 * Check Grok CLI availability.
 * @param {string} [cwd]
 * @param {object} [options]
 * @param {string} [options.binary]
 * @returns {{ available: boolean, detail?: string, binary: string }}
 */
export function getGrokAvailability(cwd, options = {}) {
  const binary = options.binary ?? resolveGrokBinary();
  let probe = binaryAvailable(binary, ["version"], { cwd });
  if (!probe.available) {
    probe = binaryAvailable(binary, ["--version"], { cwd });
  }
  return { available: probe.available, detail: probe.detail, binary };
}

/**
 * Check Grok authentication status by running `grok models`.
 * @param {string} [cwd]
 * @param {object} [options]
 * @param {string} [options.binary]
 * @returns {{ available: boolean, loggedIn: boolean, detail?: string, authMethod?: string, verified?: boolean }}
 */
export function getGrokAuthStatus(cwd, options = {}) {
  const binary = options.binary ?? resolveGrokBinary();
  const result = runCommand(binary, ["models"], { cwd, timeoutMs: 30000 });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (result.status === 0) {
    return {
      available: true,
      loggedIn: true,
      detail: stdout || stderr || "authenticated",
      authMethod: "grok-cli",
      verified: true,
    };
  }

  return {
    available: true,
    loggedIn: false,
    detail: stderr || stdout || "not authenticated",
    authMethod: "grok-cli",
    verified: false,
  };
}

/**
 * Build common spawn arguments for a headless Grok agent invocation.
 * @param {string} prompt
 * @param {object} options
 * @returns {string[]}
 */
function buildGrokArgs(prompt, options = {}) {
  const args = [];

  // Prompt can be passed via stdin or -p. We prefer -p for clarity.
  args.push("-p", prompt);

  if (options.cwd) {
    args.push("--cwd", options.cwd);
  }

  if (options.agent) {
    args.push("--agent", options.agent);
  }

  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }

  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  if (options.alwaysApprove) {
    args.push("--always-approve");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.outputFormat) {
    args.push("--output-format", options.outputFormat);
  }

  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }

  return args;
}

/**
 * Run the Grok CLI headlessly.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @param {string} [options.binary]
 * @param {string} [options.agent]
 * @param {string} [options.permissionMode]
 * @param {string} [options.sandbox]
 * @param {boolean} [options.alwaysApprove]
 * @param {string} [options.model]
 * @param {string} [options.effort]
 * @param {string} [options.outputFormat="plain"]
 * @param {string} [options.jsonSchema]
 * @param {number} [options.timeoutMs=600000]
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runHeadlessAgent(cwd, prompt, options = {}) {
  const binary = options.binary ?? resolveGrokBinary();
  const args = buildGrokArgs(prompt, {
    cwd,
    ...options,
    outputFormat: options.outputFormat ?? "plain",
  });

  const proc = await runCommandAsync(binary, args, {
    cwd,
    timeoutMs: options.timeoutMs ?? 600000,
  });
  return {
    status: proc.status,
    rawOutput: proc.stdout,
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}

/**
 * Run a simple ask with Grok.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runAsk(cwd, prompt, options = {}) {
  return runHeadlessAgent(cwd, prompt, {
    outputFormat: options.json ? "json" : "plain",
    ...options,
  });
}

/**
 * Run a read-only review.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runReview(cwd, prompt, options = {}) {
  return runHeadlessAgent(cwd, prompt, {
    agent: "explore",
    permissionMode: "plan",
    sandbox: "read-only",
    alwaysApprove: true,
    outputFormat: "plain",
    ...options,
  });
}

/**
 * Run a structured critique.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runCritique(cwd, prompt, options = {}) {
  return runHeadlessAgent(cwd, prompt, {
    agent: "explore",
    permissionMode: "plan",
    sandbox: "read-only",
    alwaysApprove: true,
    outputFormat: "json",
    jsonSchema: options.jsonSchema,
    ...options,
  });
}

/**
 * Run a delegate/task command.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runTask(cwd, prompt, options = {}) {
  const headlessOptions = {
    outputFormat: "plain",
    ...options,
  };
  if (!options.write) {
    headlessOptions.permissionMode = "plan";
    headlessOptions.sandbox = "read-only";
  } else {
    headlessOptions.alwaysApprove = true;
    delete headlessOptions.permissionMode;
    delete headlessOptions.sandbox;
  }
  return runHeadlessAgent(cwd, prompt, headlessOptions);
}

/**
 * Parse JSON from Grok output, tolerant of fenced blocks and trailing text.
 * @param {string} rawOutput
 * @param {any} [fallback]
 * @returns {any}
 */
export function parseStructuredOutput(rawOutput, fallback = undefined) {
  if (!rawOutput) {
    return fallback;
  }
  const text = rawOutput.trim();

  // Fast path: the whole output is a JSON document.
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  // Try fenced JSON block.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Scan for a JSON object, longest span first so nested objects parse whole.
  const start = text.indexOf("{");
  if (start >= 0) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try a shorter span
      }
    }
  }

  return fallback;
}

/**
 * Read a JSON schema file from the package schemas directory.
 * @param {string} schemaPath
 * @returns {object}
 */
export function readOutputSchema(schemaPath) {
  const raw = safeReadFile(schemaPath);
  if (!raw) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  return JSON.parse(raw);
}

/**
 * Build a string that injects schema instructions into a prompt.
 * @param {string} schemaPath
 * @returns {string}
 */
export function schemaInstructionsFromPath(schemaPath) {
  const schema = readOutputSchema(schemaPath);
  return `Respond with a single JSON object matching this schema:\n\n${JSON.stringify(schema, null, 2)}\n`;
}

/**
 * Build the review prompt from collected git context.
 * @param {object} params
 * @param {string} params.targetLabel
 * @param {string} [params.focusText]
 * @param {string} [params.collectionGuidance]
 * @param {string} params.reviewInput
 * @returns {string}
 */
export function buildReviewPrompt({ targetLabel, focusText, collectionGuidance, reviewInput }) {
  const focusClause = focusText ? `\nSpecific focus: ${focusText}\n` : "";
  const guidanceClause = collectionGuidance ? `\n${collectionGuidance}\n` : "";

  return `You are a senior staff engineer doing a thorough code review.

Review the following changes from ${targetLabel}.${focusClause}

Identify correctness issues, security concerns, performance problems, maintainability issues, and test gaps. For each issue provide:
- severity (critical / high / medium / low)
- a clear title and explanation
- the file path and line range
- your confidence (0.0-1.0)
- a concrete recommendation for how to fix it

Be concise but specific. Do not invent issues. If the change looks safe, say so.${guidanceClause}

${reviewInput}`;
}

/**
 * Resolve a schema path relative to the package root.
 * @param {string} name
 * @returns {string}
 */
export function resolveSchemaPath(name) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "..", "schemas", name);
}

// ---------------------------------------------------------------------------
// Image generation / editing via Grok Build's image tools
// ---------------------------------------------------------------------------

/**
 * Aspect ratios accepted by the image command (subset documented for Grok's
 * image_gen/image_edit tools).
 */
export const IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "auto"];

/**
 * Build the headless prompt that drives Grok's image_gen/image_edit tools and
 * lands the result at a concrete path.
 * @param {object} params
 * @param {string} params.prompt - user-facing image description or edit instruction
 * @param {string} params.outPath - absolute path the final image must be saved to
 * @param {string} [params.aspectRatio]
 * @param {string[]} [params.refs] - absolute paths of source/reference images
 * @returns {string}
 */
export function buildImagePrompt({ prompt, outPath, aspectRatio, refs = [] }) {
  const editing = refs.length > 0;
  const tool = editing ? "image_edit" : "image_gen";

  const lines = [];
  lines.push(
    editing
      ? "Use the image_edit tool to transform an existing image with these parameters:"
      : "Use the image_gen tool to generate a new image with these parameters:"
  );
  lines.push(`- prompt: ${prompt}`);
  if (editing) {
    lines.push("- image:");
    for (const ref of refs) {
      lines.push(`  - ${ref}`);
    }
  }
  if (aspectRatio) {
    lines.push(`- aspect_ratio: ${aspectRatio}`);
  }
  lines.push("");
  lines.push("After the tool returns, copy or move the resulting image file to this exact path (create the parent directory if needed):");
  lines.push(outPath);
  lines.push("");
  lines.push(`If the ${tool} tool is unavailable or the operation fails, say so plainly instead of falling back to another method. End your reply with the final saved file path on its own line.`);

  return lines.join("\n");
}

/**
 * Run an image generation/edit task. The image tools write files, so this runs
 * with auto-approval and no sandbox, like `run --write`.
 * @param {string} cwd
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
export async function runImage(cwd, prompt, options = {}) {
  return runHeadlessAgent(cwd, prompt, {
    alwaysApprove: true,
    outputFormat: "plain",
    ...options,
  });
}
