// Git helpers for resolving review targets and collecting diff context.

import { runCommand, runCommandChecked } from "./process.mjs";

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
 * Get the git repository root.
 * @param {string} cwd
 * @returns {string}
 */
export function getRepoRoot(cwd) {
  return runCommandChecked("git", ["rev-parse", "--show-toplevel"], { cwd }).trim();
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
    const diffArgs = ["diff", "--", "."];
    const diff = runCommandChecked("git", diffArgs, { cwd });
    const byteCount = Buffer.byteLength(diff, "utf8");
    const fileCount = runCommandChecked("git", ["diff", "--name-only", "--", "."], { cwd })
      .trim()
      .split("\n")
      .filter(Boolean).length;

    if (byteCount > DIFF_BYTE_LIMIT || fileCount > DIFF_FILE_LIMIT) {
      return {
        input: `The working tree diff is too large to embed (${fileCount} files, ${byteCount} bytes). Please ask the user to narrow the scope or review locally.`,
        fileCount,
        byteCount,
      };
    }

    return {
      input: `Working tree diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
      fileCount,
      byteCount,
    };
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
