#!/usr/bin/env node

import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(typeof code === "number" ? code : 0);
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
