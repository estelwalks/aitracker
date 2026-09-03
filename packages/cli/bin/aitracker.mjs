#!/usr/bin/env node

import { cliErrorMessage, runCli } from "../src/cli.mjs";

try {
  process.exitCode = await runCli();
} catch (error) {
  console.error(`aitracker: ${cliErrorMessage(error)}`);
  process.exitCode = 1;
}
