import assert from "node:assert";
import { describe, it } from "node:test";

import { runCli, fakeGrokEnv } from "./helpers.mjs";

describe("run", () => {
  it("runs a foreground task", () => {
    const result = runCli(["run", "hello world", "--json"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.status, 0);
    assert.match(parsed.output, /hello world/);
  });

  it("queues a background task", () => {
    const result = runCli(["run", "background task", "--background", "--json"], {
      env: fakeGrokEnv(),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.queued, true);
    assert.ok(parsed.runId);
  });

  it("passes --write flag", () => {
    const result = runCli(["run", "write task", "--write", "--json"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.status, 0);
  });

  it("fails without a prompt", () => {
    const result = runCli(["run"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /prompt is required/i);
  });
});
