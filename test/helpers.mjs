// Test helpers and fake grok fixture for use-grok tests.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run the use-grok CLI with the given arguments.
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
export function runCli(args, options = {}) {
  const scriptPath = path.resolve(__dirname, "..", "bin", "use-grok.mjs");
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Create a temporary directory and run a callback, cleaning up afterwards.
 * @param {(dir: string) => Promise<void> | void} callback
 */
export async function withTempDir(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "use-grok-test-"));
  try {
    await callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a temporary git repository and run a callback.
 * @param {(dir: string) => Promise<void> | void} callback
 */
export async function withTempRepo(callback) {
  await withTempDir(async (dir) => {
    runCommand("git", ["init"], { cwd: dir });
    runCommand("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    runCommand("git", ["config", "user.name", "Test User"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "README.md"), "# test\n", "utf8");
    runCommand("git", ["add", "."], { cwd: dir });
    runCommand("git", ["commit", "-m", "init"], { cwd: dir });
    await callback(dir);
  });
}

/**
 * Run a command synchronously.
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 */
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `Command ${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
  return result;
}

/**
 * Resolve the path to a fixture file.
 * @param {string} name
 * @returns {string}
 */
export function fixturePath(name) {
  return path.resolve(__dirname, "fixtures", name);
}

/**
 * Resolve the path to the fake grok binary.
 * @returns {string}
 */
export function fakeGrokPath() {
  return fixturePath("fake-grok.mjs");
}

/**
 * Default environment that points GROK_BINARY at the fake fixture.
 * @returns {Record<string,string>}
 */
export function fakeGrokEnv() {
  return {
    GROK_BINARY: fakeGrokPath(),
    USE_GROK_TEST_AUTH: "1",
  };
}
