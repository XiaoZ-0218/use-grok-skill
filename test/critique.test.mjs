import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { runCli, fakeGrokEnv, withTempRepo } from "./helpers.mjs";

describe("critique", () => {
  it("renders structured findings", async () => {
    await withTempRepo(async (dir) => {
      fs.writeFileSync(path.join(dir, "feature.js"), "console.log('x');\n", "utf8");

      const result = runCli(["critique"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /needs-attention/);
      assert.match(result.stdout, /Fake finding/);
    });
  });

  it("returns parsed JSON with --json", async () => {
    await withTempRepo(async (dir) => {
      fs.writeFileSync(path.join(dir, "feature.js"), "console.log('x');\n", "utf8");

      const result = runCli(["critique", "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 0);
      assert.strictEqual(parsed.parsed.verdict, "needs-attention");
      assert.strictEqual(parsed.parsed.findings[0].title, "Fake finding");
    });
  });

  it("waits for a background critique with --wait", async () => {
    await withTempRepo(async (dir) => {
      fs.writeFileSync(path.join(dir, "feature.js"), "console.log('x');\n", "utf8");

      const result = runCli(["critique", "--background", "--wait", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 0);
      assert.ok(parsed.runId);
      assert.strictEqual(parsed.parsed.verdict, "needs-attention");
    });
  });
});
