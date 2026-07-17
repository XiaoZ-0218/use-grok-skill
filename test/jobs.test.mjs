import assert from "node:assert";
import { describe, it } from "node:test";

import { runCli, fakeGrokEnv, withTempRepo } from "./helpers.mjs";

describe("jobs", () => {
  it("lists queued and completed runs", async () => {
    await withTempRepo(async (dir) => {
      const run = runCli(["run", "test job", "--background", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      assert.strictEqual(run.status, 0, run.stderr);
      const { runId } = JSON.parse(run.stdout);

      const list = runCli(["runs", "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(list.status, 0, list.stderr);
      const parsed = JSON.parse(list.stdout);
      assert.ok(parsed.jobs.some((j) => j.id === runId));
    });
  });

  it("shows a specific run", async () => {
    await withTempRepo(async (dir) => {
      const run = runCli(["run", "test job", "--background", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      const { runId } = JSON.parse(run.stdout);

      const show = runCli(["show", runId, "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(show.status, 0, show.stderr);
      const parsed = JSON.parse(show.stdout);
      assert.strictEqual(parsed.runId, runId);
    });
  });

  it("stops a queued run", async () => {
    await withTempRepo(async (dir) => {
      const run = runCli(["run", "test job", "--background", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      const { runId } = JSON.parse(run.stdout);

      const stop = runCli(["stop", runId, "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(stop.status, 0, stop.stderr);
      const parsed = JSON.parse(stop.stdout);
      assert.match(parsed, /Stopped run/);
    });
  });
});
