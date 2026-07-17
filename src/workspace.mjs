// Resolve the workspace root for a given working directory.

import { runCommandChecked } from "./process.mjs";

/**
 * Resolve the workspace root. Prefer the git repository root; fall back to cwd.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveWorkspaceRoot(cwd) {
  try {
    return runCommandChecked("git", ["rev-parse", "--show-toplevel"], { cwd }).trim();
  } catch {
    return cwd;
  }
}
