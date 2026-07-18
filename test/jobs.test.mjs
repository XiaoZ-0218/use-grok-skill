import assert from "node:assert";
import { describe, it } from "node:test";

import { runCli, fakeGrokEnv, withTempRepo } from "./helpers.mjs";

describe("jobs", () => {
  it("runs a background job to completion via the worker", async () => {
    await withTempRepo(async (dir) => {
      const run = runCli(["run", "test job", "--background", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      assert.strictEqual(run.status, 0, run.stderr);
      const { runId } = JSON.parse(run.stdout);

      const wait = runCli(["runs", runId, "--wait", "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(wait.status, 0, wait.stderr);
      assert.strictEqual(JSON.parse(wait.stdout).status, "completed");

      const show = runCli(["show", runId, "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(show.status, 0, show.stderr);
      const shown = JSON.parse(show.stdout);
      assert.match(shown.job.result.rawOutput, /test job/);
    });
  });

  it("lists queued and completed runs", async () => {
    await withTempRepo(async (dir) => {
      const run = runCli(["run", "test job", "--background", "--json"], {
        cwd: dir,
        env: fakeGrokEnv(),
      });
      assert.strictEqual(run.status, 0, run.stderr);
      const { runId } = JSON.parse(run.stdout);

      const wait = runCli(["runs", runId, "--wait", "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(wait.status, 0, wait.stderr);

      const list = runCli(["runs", "--json"], { cwd: dir, env: fakeGrokEnv() });
      assert.strictEqual(list.status, 0, list.stderr);
      const parsed = JSON.parse(list.stdout);
      const job = parsed.jobs.find((j) => j.id === runId);
      assert.ok(job);
      assert.strictEqual(job.status, "completed");
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

  it("stops an active run", async () => {
    await withTempRepo(async (dir) => {
      // Slow fake grok keeps the worker alive so there is something to stop.
      const env = { ...fakeGrokEnv(), USE_GROK_TEST_SLEEP_MS: "15000" };
      const run = runCli(["run", "slow job", "--background", "--json"], { cwd: dir, env });
      assert.strictEqual(run.status, 0, run.stderr);
      const { runId } = JSON.parse(run.stdout);

      const stop = runCli(["stop", runId, "--json"], { cwd: dir, env });
      assert.strictEqual(stop.status, 0, stop.stderr);
      assert.match(JSON.parse(stop.stdout), /Stopped run/);

      const status = runCli(["runs", runId, "--json"], { cwd: dir, env });
      assert.strictEqual(JSON.parse(status.stdout).status, "cancelled");
    });
  });
});
