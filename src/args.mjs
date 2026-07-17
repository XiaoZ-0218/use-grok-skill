// Minimal argument parser. No dependencies.

/**
 * Parse an argv array into flags, values, and positionals.
 *
 * @param {string[]} argv
 * @param {object} config
 * @param {string[]} [config.valueOptions] - flags that take a value
 * @param {string[]} [config.booleanOptions] - flags that are booleans
 * @param {Record<string,string>} [config.aliasMap] - short -> long aliases
 * @param {"positional"|"error"|"ignore"} [config.unknownMode="error"] - how to handle unknown flags
 * @returns {{
 *   flags: Record<string, string|boolean|undefined>,
 *   positionals: string[],
 *   raw: string[]
 * }}
 */
export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const unknownMode = config.unknownMode ?? "error";

  /** @type {Record<string, string|boolean|undefined>} */
  const flags = {};
  const positionals = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      const value = eq >= 0 ? arg.slice(eq + 1) : undefined;

      if (!key) {
        throw new Error(`Invalid argument: ${arg}`);
      }

      if (value !== undefined) {
        flags[key] = value;
      } else if (valueOptions.has(key)) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new Error(`Option --${key} requires a value`);
        }
        flags[key] = next;
        i += 1;
      } else if (booleanOptions.has(key) || unknownMode !== "error") {
        flags[key] = true;
      } else {
        // Treat unknown long flags without value as booleans if no config is provided.
        flags[key] = true;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      // Short flag(s). We support either a cluster or a single short flag with value.
      const chars = arg.slice(1);
      if (chars.includes("=")) {
        const [short, value] = chars.split("=");
        const key = aliasMap[short] ?? short;
        flags[key] = value;
        i += 1;
        continue;
      }

      for (let j = 0; j < chars.length; j += 1) {
        const short = chars[j];
        const key = aliasMap[short] ?? short;
        if (valueOptions.has(key)) {
          // The rest of the cluster or the next token is the value.
          const rest = chars.slice(j + 1);
          if (rest) {
            flags[key] = rest;
            break;
          }
          const next = argv[i + 1];
          if (next === undefined || next.startsWith("-")) {
            throw new Error(`Option -${short} requires a value`);
          }
          flags[key] = next;
          i += 1;
          break;
        }
        flags[key] = true;
      }
      i += 1;
      continue;
    }

    positionals.push(arg);
    i += 1;
  }

  return { flags, positionals, raw: argv };
}

/**
 * Split a single raw argument string (e.g. from a slash command) into tokens.
 * Respects single and double quotes.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitRawArgumentString(raw) {
  if (!raw) return [];
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
