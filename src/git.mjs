// Git helpers for resolving review targets and collecting diff context.

import fs from "node:fs";
import path from "node:path";

import { runCommand, runCommandChecked } from "./process.mjs";
import { isProbablyText } from "./fs.mjs";

const DIFF_BYTE_LIMIT = 200_000;
const DIFF_FILE_LIMIT = 200;

/**
 * Ensure the cwd is inside a git repository.
 * @param {string} cwd
 */
export function ensureGitRepository(cwd) {
  const result = runCommand("git", ["rev-parse", "--git-dir"], { cwd });
  if (result.status !== 0) {
    throw new Error("Not a git repository");
  }
}

/**
 * Get the current branch name.
 * @param {string} cwd
 * @returns {string}
 */
export function getCurrentBranch(cwd) {
  return runCommandChecked("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).trim();
}

/**
 * Detect the default branch (origin/HEAD, main, master, trunk).
 * @param {string} cwd
 * @returns {string|null}
 */
export function detectDefaultBranch(cwd) {
  const originHead = runCommand("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd });
  if (originHead.status === 0) {
    const name = originHead.stdout.trim().replace(/^origin\//, "");
    if (name) return name;
  }
  for (const candidate of ["main", "master", "trunk"]) {
    const result = runCommand("git", ["rev-parse", `--verify`, `refs/heads/${candidate}`], { cwd });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get the working tree state: clean or dirty.
 * @param {string} cwd
 * @returns {{ clean: boolean, hasUncommittedChanges: boolean }}
 */
export function getWorkingTreeState(cwd) {
  const result = runCommandChecked("git", ["status", "--porcelain=v1"], { cwd });
  const output = result.trim();
  return {
    clean: output === "",
    hasUncommittedChanges: output !== "",
  };
}

/**
 * Resolve the review target based on scope and base.
 * @param {string} cwd
 * @param {object} options
 * @param {string} [options.base]
 * @param {"auto"|"working-tree"|"branch"} [options.scope="auto"]
 * @returns {{ mode: "working-tree"|"branch", base: string, head?: string, label: string }}
 */
export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);

  const scope = options.scope ?? "auto";
  const workingTree = getWorkingTreeState(cwd);

  if (scope === "working-tree") {
    return { mode: "working-tree", base: "HEAD", label: "working tree" };
  }

  if (scope === "branch") {
    const base = options.base ?? detectDefaultBranch(cwd);
    if (!base) {
      throw new Error("Could not detect default branch; pass --base explicitly");
    }
    const head = getCurrentBranch(cwd);
    return { mode: "branch", base, head, label: `${head} vs ${base}` };
  }

  // auto
  if (workingTree.hasUncommittedChanges) {
    return { mode: "working-tree", base: "HEAD", label: "working tree" };
  }

  const base = options.base ?? detectDefaultBranch(cwd);
  if (!base) {
    throw new Error("Could not detect default branch; pass --base explicitly");
  }
  const head = getCurrentBranch(cwd);
  return { mode: "branch", base, head, label: `${head} vs ${base}` };
}

/**
 * Measure the byte size of a git command's output.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {number}
 */
function measureGitOutputBytes(cwd, args) {
  const result = runCommand("git", args, { cwd });
  if (result.status !== 0) return Infinity;
  return Buffer.byteLength(result.stdout, "utf8");
}

/**
 * Collect the review context as a prompt-ready string.
 * @param {string} cwd
 * @param {object} target
 * @returns {{ input: string, fileCount: number, byteCount: number }}
 */
export function collectReviewContext(cwd, target) {
  if (target.mode === "working-tree") {
    return collectWorkingTreeContext(cwd);
  }

  const range = `${target.base}...HEAD`;
  const fileCount = runCommandChecked("git", ["diff", "--name-only", range], { cwd })
    .trim()
    .split("\n")
    .filter(Boolean).length;
  const byteCount = measureGitOutputBytes(cwd, ["diff", range]);

  if (byteCount > DIFF_BYTE_LIMIT || fileCount > DIFF_FILE_LIMIT) {
    const summary = runCommandChecked("git", ["diff", "--stat", range], { cwd });
    return {
      input: `Branch diff is too large to embed (${fileCount} files, ${byteCount} bytes). Summary:\n\n${summary}`,
      fileCount,
      byteCount,
    };
  }

  const diff = runCommandChecked("git", ["diff", range], { cwd });
  return {
    input: `Branch diff (${target.label}):\n\n\`\`\`diff\n${diff}\n\`\`\``,
    fileCount,
    byteCount,
  };
}

/**
 * Collect working tree context: staged + unstaged changes to tracked files,
 * plus the contents of untracked files (new files are invisible to git diff).
 * @param {string} cwd
 * @returns {{ input: string, fileCount: number, byteCount: number }}
 */
function collectWorkingTreeContext(cwd) {
  // A repo without any commit has no HEAD to diff against; everything is staged.
  const hasHead = runCommand("git", ["rev-parse", "--verify", "HEAD"], { cwd }).status === 0;
  const baseArgs = hasHead ? ["HEAD"] : ["--cached"];

  const diff = runCommandChecked("git", ["diff", ...baseArgs, "--", "."], { cwd });
  const trackedFiles = runCommandChecked("git", ["diff", "--name-only", ...baseArgs, "--", "."], { cwd })
    .trim()
    .split("\n")
    .filter(Boolean);
  const untrackedFiles = runCommandChecked(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", "."],
    { cwd }
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  // Read untracked files once; reuse for both the size guard and the prompt.
  const untracked = [];
  for (const name of untrackedFiles) {
    let buffer;
    try {
      buffer = fs.readFileSync(path.resolve(cwd, name));
    } catch {
      untracked.push({ name, content: null, note: "unreadable" });
      continue;
    }
    if (!isProbablyText(buffer)) {
      untracked.push({ name, content: null, note: "binary file, not shown" });
      continue;
    }
    untracked.push({ name, content: buffer.toString("utf8") });
  }

  const fileCount = trackedFiles.length + untrackedFiles.length;
  const byteCount =
    Buffer.byteLength(diff, "utf8") +
    untracked.reduce((sum, f) => sum + (f.content ? Buffer.byteLength(f.content, "utf8") : 0), 0);

  if (byteCount > DIFF_BYTE_LIMIT || fileCount > DIFF_FILE_LIMIT) {
    return {
      input: `The working tree changes are too large to embed (${fileCount} files, ${byteCount} bytes). Please ask the user to narrow the scope or review locally.`,
      fileCount,
      byteCount,
    };
  }

  const sections = [];
  if (diff.trim()) {
    sections.push(`Working tree diff (staged and unstaged):\n\n\`\`\`diff\n${diff}\n\`\`\``);
  }
  for (const file of untracked) {
    if (file.content === null) {
      sections.push(`New untracked file \`${file.name}\` (${file.note}).`);
    } else {
      sections.push(`New untracked file \`${file.name}\`:\n\n\`\`\`\n${file.content}\n\`\`\``);
    }
  }
  if (sections.length === 0) {
    sections.push("The working tree has no textual changes to review.");
  }

  return { input: sections.join("\n\n"), fileCount, byteCount };
}
