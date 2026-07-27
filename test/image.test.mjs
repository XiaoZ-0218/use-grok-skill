import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildImagePrompt } from "../src/grok.mjs";
import { runCli, fakeGrokEnv, withTempDir } from "./helpers.mjs";

describe("buildImagePrompt", () => {
  it("builds an image_gen prompt without refs", () => {
    const prompt = buildImagePrompt({
      prompt: "a cat",
      outPath: "/tmp/out.png",
      aspectRatio: "1:1",
      refs: [],
    });
    assert.match(prompt, /image_gen/);
    assert.doesNotMatch(prompt, /image_edit tool to transform/);
    assert.match(prompt, /- prompt: a cat/);
    assert.match(prompt, /- aspect_ratio: 1:1/);
    assert.match(prompt, /\/tmp\/out\.png/);
  });

  it("builds an image_edit prompt with one ref per line", () => {
    const prompt = buildImagePrompt({
      prompt: "combine",
      outPath: "/tmp/out.png",
      refs: ["/tmp/a.png", "/tmp/b.png"],
    });
    assert.match(prompt, /image_edit/);
    assert.match(prompt, /- image:\n {2}- \/tmp\/a\.png\n {2}- \/tmp\/b\.png/);
    assert.doesNotMatch(prompt, /aspect_ratio/);
  });
});

describe("image", () => {
  it("runs a foreground image generation and writes the out file", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "a cat astronaut", "--json"], {
        env: fakeGrokEnv(),
        cwd: dir,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 0);
      assert.strictEqual(parsed.outExists, true);
      assert.ok(parsed.runId);
      assert.match(parsed.out, /grok-image-\d{14}-[0-9a-f]{8}\.png$/);
      assert.ok(fs.existsSync(parsed.out), "out file should exist");
      assert.match(parsed.output, /image_gen/);
      assert.match(parsed.output, /a cat astronaut/);
      // Image runs must be write-capable (like run --write).
      assert.match(parsed.output, /approve=always/);
    });
  });

  it("passes out path and aspect ratio to the grok prompt", async () => {
    await withTempDir((dir) => {
      const result = runCli(
        ["image", "banner", "--out", "assets/banner.png", "--aspect-ratio", "16:9", "--json"],
        { env: fakeGrokEnv(), cwd: dir }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(parsed.out, /assets\/banner\.png$/);
      assert.ok(fs.existsSync(parsed.out));
      assert.match(parsed.output, /aspect_ratio: 16:9/);
    });
  });

  it("uses image_edit with reference images listed one per line", async () => {
    await withTempDir((dir) => {
      const refA = path.join(dir, "a.png");
      const refB = path.join(dir, "b.png");
      fs.writeFileSync(refA, "fake");
      fs.writeFileSync(refB, "fake");
      const result = runCli(
        ["image", "combine these", "--ref", refA, "--ref", refB, "--json"],
        { env: fakeGrokEnv(), cwd: dir }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(parsed.output, /image_edit/);
      assert.match(parsed.output, /- image:\n {2}- .*a\.png\n {2}- .*b\.png/);
    });
  });

  it("fails when a reference image does not exist", () => {
    const result = runCli(["image", "edit this", "--ref", "nope.png"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Reference image not found/);
  });

  it("fails when a reference path is a directory", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "edit this", "--ref", dir], {
        env: fakeGrokEnv(),
        cwd: dir,
      });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /not a file/);
    });
  });

  it("rejects an invalid aspect ratio", () => {
    const result = runCli(["image", "cat", "--aspect-ratio", "7:5"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Invalid aspect ratio/);
  });

  it("fails when grok succeeds but no image file appears", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "cat", "--json"], {
        env: { ...fakeGrokEnv(), USE_GROK_TEST_SKIP_WRITE: "1" },
        cwd: dir,
      });
      assert.strictEqual(result.status, 1);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 1);
      assert.strictEqual(parsed.outExists, false);
      assert.match(result.stderr, /no image file was found/);
    });
  });

  it("queues a background image job", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "background cat", "--background", "--json"], {
        env: fakeGrokEnv(),
        cwd: dir,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.queued, true);
      assert.ok(parsed.runId);
      assert.ok(parsed.out);
    });
  });

  it("runs a background image job with --wait to completion", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "waited cat", "--background", "--wait", "--json"], {
        env: fakeGrokEnv(),
        cwd: dir,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.status, 0);
      assert.strictEqual(parsed.outExists, true);
      assert.ok(fs.existsSync(parsed.out));
    });
  });

  it("prints a Saved line in human output mode", async () => {
    await withTempDir((dir) => {
      const result = runCli(["image", "plain cat", "--out", "cat.png"], {
        env: fakeGrokEnv(),
        cwd: dir,
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Saved: .*cat\.png/);
    });
  });

  it("fails without a prompt", () => {
    const result = runCli(["image"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /prompt is required/i);
  });
});
