// Prompt template loading and interpolation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a prompt template from the prompts directory.
 * @param {string} rootDir - package root directory
 * @param {string} name - template file name
 * @returns {string}
 */
export function loadPromptTemplate(rootDir, name) {
  const filePath = path.join(rootDir, "prompts", name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Replace {{KEY}} placeholders in a template with values from variables.
 * @param {string} template
 * @param {Record<string,string>} variables
 * @returns {string}
 */
export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key];
    }
    return match;
  });
}

/**
 * Resolve the package root directory from a module URL.
 * @param {string|URL} moduleUrl
 * @returns {string}
 */
export function resolvePackageRoot(moduleUrl) {
  const __dirname = path.dirname(fileURLToPath(moduleUrl));
  return path.resolve(__dirname, "..");
}
