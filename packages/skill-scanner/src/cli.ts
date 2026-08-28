#!/usr/bin/env node
import { main } from "./cli/main.js";
process.exitCode = await main(process.argv.slice(2));
