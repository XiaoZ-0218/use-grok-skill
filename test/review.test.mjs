import assert from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { runCli, fakeGrokEnv, withTempDir, withTempRepo } from "./helpers.mjs";

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

  it("fails outside a git repository", async () => {
    await withTempDir(async (dir) => {
      const result = runCli(["review"], { cwd: dir, env: fakeGrokEnv() });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /Not a git repository/i);
    });
  });
});
