import assert from "node:assert";
import { describe, it } from "node:test";

import { runCli, fakeGrokEnv } from "./helpers.mjs";

describe("ask", () => {
  it("echoes the prompt via fake grok", () => {
    const result = runCli(["ask", "hello world", "--json"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.status, 0);
    assert.match(parsed.output, /hello world/);
  });

  it("passes model and effort to grok", () => {
    const result = runCli(["ask", "hello", "--model", "grok-4", "--effort", "high"], {
      env: fakeGrokEnv(),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /model=grok-4/);
    assert.match(result.stdout, /effort=high/);
  });

  it("fails without a prompt", () => {
    const result = runCli(["ask"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /prompt is required/i);
  });
});
