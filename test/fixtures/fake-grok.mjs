#!/usr/bin/env node

// Fake grok binary for testing use-grok without a real Grok account.

import fs from "node:fs";
import path from "node:path";
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
const jsonSchema = findArg("--json-schema");
const model = findArg("--model");
const effort = findArg("--effort");

// Optional delay so tests can observe/stop in-flight background jobs.
const sleepMs = Number(process.env.USE_GROK_TEST_SLEEP_MS) || 0;
if (sleepMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}

// Echo model/effort selection to stderr so tests can assert it.
if (model) {
  process.stderr.write(`[fake-grok] model=${model}\n`);
}
if (effort) {
  process.stderr.write(`[fake-grok] effort=${effort}\n`);
}

if (outputFormat === "json") {
  if (jsonSchema) {
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

// Simulate the image tools: when the prompt asks to save the result to an
// exact path, write a small file there (unless the test opts out).
if (process.env.USE_GROK_TEST_SKIP_WRITE !== "1") {
  const marker = "copy or move the resulting image file to this exact path";
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex >= 0) {
    const outLine = prompt
      .slice(markerIndex + marker.length)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("("));
    if (outLine) {
      fs.mkdirSync(path.dirname(outLine), { recursive: true });
      fs.writeFileSync(outLine, "fake image data");
    }
  }
}

const meta = [];
if (model) meta.push(`model=${model}`);
if (effort) meta.push(`effort=${effort}`);
if (args.includes("--always-approve")) meta.push("approve=always");
const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";
console.log(`Fake Grok says: ${prompt}${suffix}`);
process.exit(0);
