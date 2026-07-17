import assert from "node:assert";
import { describe, it } from "node:test";

import { parseArgs, splitRawArgumentString } from "../src/args.mjs";

describe("parseArgs", () => {
  it("parses flags and positionals", () => {
    const result = parseArgs(["--model", "grok-4", "--json", "hello", "world"], {
      valueOptions: ["model"],
      booleanOptions: ["json"],
    });
    assert.strictEqual(result.flags.model, "grok-4");
    assert.strictEqual(result.flags.json, true);
    assert.deepStrictEqual(result.positionals, ["hello", "world"]);
  });

  it("supports --key=value syntax", () => {
    const result = parseArgs(["--effort=high", "review"], {
      valueOptions: ["effort"],
    });
    assert.strictEqual(result.flags.effort, "high");
    assert.deepStrictEqual(result.positionals, ["review"]);
  });

  it("supports short flags with values", () => {
    const result = parseArgs(["-m", "grok-4", "ask"], {
      valueOptions: ["model"],
      aliasMap: { m: "model" },
    });
    assert.strictEqual(result.flags.model, "grok-4");
    assert.deepStrictEqual(result.positionals, ["ask"]);
  });

  it("stops parsing flags after --", () => {
    const result = parseArgs(["--json", "--", "--not-a-flag"], {
      booleanOptions: ["json"],
    });
    assert.strictEqual(result.flags.json, true);
    assert.deepStrictEqual(result.positionals, ["--not-a-flag"]);
  });

  it("throws on missing value for value option", () => {
    assert.throws(() => {
      parseArgs(["--model"], { valueOptions: ["model"] });
    }, /requires a value/);
  });
});

describe("splitRawArgumentString", () => {
  it("splits on whitespace", () => {
    assert.deepStrictEqual(splitRawArgumentString("a b c"), ["a", "b", "c"]);
  });

  it("respects double quotes", () => {
    assert.deepStrictEqual(splitRawArgumentString('a "b c" d'), ["a", "b c", "d"]);
  });

  it("respects single quotes", () => {
    assert.deepStrictEqual(splitRawArgumentString("a 'b c' d"), ["a", "b c", "d"]);
  });

  it("returns empty array for empty input", () => {
    assert.deepStrictEqual(splitRawArgumentString(""), []);
  });
});
