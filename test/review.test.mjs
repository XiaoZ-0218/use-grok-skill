import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { runCli, fakeGrokEnv, withTempDir, withTempRepo, runCommand } from "./helpers.mjs";

describe("review", () => {
  it("reviews working tree changes", async () => {
    await withTempRepo(async (dir) => {
      const readme = path.join(dir, "README.md");
      fs.writeFileSync(readme, "# changed\n", "utf8");

      const result = runCli(["review", "--scope", "working-tree", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 0);
      assert.match(parsed.output, /changed/);
    });
  });

  it("includes staged changes in the review context", async () => {
    await withTempRepo(async (dir) => {
      fs.writeFileSync(path.join(dir, "staged.js"), "const staged = 42;\n", "utf8");
      runCommand("git", ["add", "staged.js"], { cwd: dir });

      const result = runCli(["review", "--scope", "working-tree", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(parsed.output, /staged = 42/);
    });
  });

  it("includes untracked files in the review context", async () => {
    await withTempRepo(async (dir) => {
      fs.writeFileSync(path.join(dir, "fresh.js"), "const fresh = 1;\n", "utf8");

      const result = runCli(["review", "--scope", "working-tree", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(parsed.output, /fresh = 1/);
    });
  });

  it("fails outside a git repository", async () => {
    await withTempDir(async (dir) => {
      const result = runCli(["review"], { cwd: dir, env: fakeGrokEnv() });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /Not a git repository/i);
    });
  });
});
