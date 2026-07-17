// Small filesystem helpers used across the CLI.
// Uses only Node.js stdlib so the package stays dependency-free.

import fs from "node:fs";
import path from "node:path";

/**
 * Ensure a path is absolute, resolving relative paths against cwd.
 * @param {string} cwd
 * @param {string} maybePath
 * @returns {string}
 */
export function ensureAbsolutePath(cwd, maybePath) {
  if (!maybePath) return cwd;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

/**
 * Read a JSON file and parse it. Returns undefined if the file does not exist.
 * Throws if the file exists but is not valid JSON.
 * @param {string} filePath
 * @returns {any|undefined}
 */
export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return undefined;
  }
  return JSON.parse(raw);
}

/**
 * Atomically write a JSON file with pretty printing.
 * @param {string} filePath
 * @param {any} value
 */
export function writeJsonFile(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Read a text file, returning undefined if it does not exist.
 * @param {string} filePath
 * @returns {string|undefined}
 */
export function safeReadFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Heuristic: is this buffer likely text rather than binary?
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isProbablyText(buffer) {
  if (buffer.length === 0) return true;
  // Allow common text control characters (tab, newline, carriage return) and reject null bytes.
  for (let i = 0; i < Math.min(buffer.length, 512); i += 1) {
    const byte = buffer[i];
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}

/**
 * Read stdin if it is piped; otherwise return undefined.
 * @returns {Promise<string|undefined>}
 */
export async function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw || undefined;
}

/**
 * Append a line to a file, creating parent directories if needed.
 * @param {string} filePath
 * @param {string} line
 */
export function appendLogLine(filePath, line) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, line, "utf8");
}

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
