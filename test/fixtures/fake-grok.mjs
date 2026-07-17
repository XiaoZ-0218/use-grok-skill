#!/usr/bin/env node

// Fake grok binary for testing use-grok without a real Grok account.

import process from "node:process";

const args = process.argv.slice(2);

function findArg(flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function getPrompt() {
  return findArg("-p") ?? "";
}

if (args[0] === "version" || args[0] === "--version") {
  console.log("grok version 0.0.0-test");
  process.exit(0);
}

if (args[0] === "models") {
  if (process.env.USE_GROK_TEST_AUTH === "1") {
    console.log("grok-4.5");
    console.log("grok-build");
    process.exit(0);
  }
  process.stderr.write("Error: not authenticated\n");
  process.exit(1);
}

if (args[0] === "login" || args[0] === "logout") {
  process.exit(0);
}

const prompt = getPrompt();
const outputFormat = findArg("--output-format") ?? "plain";
const model = findArg("--model");
const effort = findArg("--effort");

// Echo model/effort selection to stderr so tests can assert it.
if (model) {
  process.stderr.write(`[fake-grok] model=${model}\n`);
}
if (effort) {
  process.stderr.write(`[fake-grok] effort=${effort}\n`);
}

if (outputFormat === "json") {
  if (prompt.includes("CRITIQUE")) {
    console.log(
      JSON.stringify(
        {
          verdict: "needs-attention",
          summary: "Fake critique summary.",
          findings: [
            {
              severity: "high",
              title: "Fake finding",
              body: "This is a fake finding for testing.",
              file: "src/fake.js",
              line_start: 1,
              line_end: 2,
              confidence: 0.9,
              recommendation: "Fix it.",
            },
          ],
          next_steps: ["Address the finding."],
        },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify({ status: "ok", echo: prompt, model, effort }));
  }
  process.exit(0);
}

const meta = [];
if (model) meta.push(`model=${model}`);
if (effort) meta.push(`effort=${effort}`);
const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";
console.log(`Fake Grok says: ${prompt}${suffix}`);
process.exit(0);
