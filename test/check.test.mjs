import assert from "node:assert";
import { describe, it } from "node:test";

import { runCli, fakeGrokEnv, fakeGrokPath } from "./helpers.mjs";

describe("check", () => {
  it("reports ready when grok is available and authenticated", () => {
    const result = runCli(["check", "--json"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ready, true);
    assert.strictEqual(parsed.node.available, true);
    assert.strictEqual(parsed.grok.available, true);
    assert.strictEqual(parsed.auth.loggedIn, true);
  });

  it("reports not ready when grok is not authenticated", () => {
    const env = { GROK_BINARY: fakeGrokPath() };
    const result = runCli(["check", "--json"], { env });
    assert.strictEqual(result.status, 1, result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ready, false);
    assert.strictEqual(parsed.auth.loggedIn, false);
  });

  it("prints human-readable output by default", () => {
    const result = runCli(["check"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Grok is ready/);
  });
});
