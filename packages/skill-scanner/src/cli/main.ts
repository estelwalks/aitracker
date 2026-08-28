import { createRequire } from "node:module";
import { scanSkill } from "../index.js";
import type { FetchLike } from "../types.js";
import { parseArgs, UsageError } from "./args.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { renderJson, renderSummary, writeOutput } from "./output.js";

const USAGE = `Usage: skill-scanner <file-or-directory> [options]

Scan a Skill file or directory (quick static scan, or full scan with model review).

Options:
  --config <file>               JSON config file (default: ./.skill-scanner.json)
  --mode <quick|full>           scan mode (default: full if a model is configured, else quick)
  --quick                       static-only scan (same as --mode quick)
  --locale <locale>             zh-CN | en-US | ja-JP | ko-KR (default: zh-CN)
  --provider <openai-responses|openai-completions|anthropic>
                                LLM protocol (legacy openai maps to openai-completions)
  --endpoint <url>              LLM base URL
  --api-key <key>               LLM API key
  --lite-model <name>           model for rule verification + semantic dedup
  --pro-model <name>            model for single/cross-file behavioral analysis
  --timeout-ms <ms>             per-call model timeout (default: 120000)
  --context-window-tokens <n>   model context window in tokens
  --max-agent-turns <n>         behavioral agent tool-call turns (default: 12)
  --json                        output the full JSON report
  --output <file>               write the report to a file
  --verbose                     verbose scan logging to stderr
  -h, --help                    show this help
  -v, --version                 show version

Config precedence: CLI flags > config file > LLM_* environment variables.
`;

export interface MainIO {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetch?: FetchLike;
}

export async function main(argv: string[], io: MainIO = {}): Promise<number> {
  let args;
  try { args = parseArgs(argv); }
  catch (error) {
    if (error instanceof UsageError) { console.error(`error: ${error.message}`); console.error("Run 'skill-scanner --help' for usage."); return 1; }
    throw error;
  }
  if (args.help) { console.log(USAGE); return 0; }
  if (args.version) { console.log(packageVersion()); return 0; }
  if (args.positional === undefined) { console.error("error: missing path argument"); console.error("Run 'skill-scanner --help' for usage."); return 1; }

  const cwd = io.cwd ?? process.cwd();
  const env = { ...(io.env ?? process.env) };
  loadDotEnv(env, cwd);
  let config;
  try { config = loadConfig(args, env, cwd); }
  catch (error) { console.error(`error: ${(error as Error).message}`); return 1; }

  if (args.verbose) {
    console.error(`[skill-scanner] config: mode=${config.mode} locale=${config.locale}${config.model ? ` provider=${config.model.provider ?? "auto"} lite=${config.model.liteModel} pro=${config.model.proModel}` : " (no model configured)"}`);
  }
  if (config.mode === "quick" && !config.modeExplicit) {
    console.error("LLM model not fully configured (endpoint/apiKey/liteModel/proModel); running STATIC-ONLY quick scan.");
  }
  console.error(`Scanning ${args.positional} (${config.mode}${config.model ? "" : " static-only"})...`);

  let report;
  const started = performance.now();
  try {
    report = await scanSkill({ mode: config.mode, locale: config.locale, paths: [args.positional], ...(config.model ? { model: config.model } : {}) }, {
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(args.verbose ? { log: (message: string) => console.error(`[skill-scanner] ${message}`) } : {}),
    });
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  if (args.verbose) console.error(`[skill-scanner] scan completed in ${Math.round(performance.now() - started)}ms`);

  const text = args.json ? renderJson(report) : renderSummary(report);
  if (args.output) {
    try { writeOutput(args.output, text); } catch (error) { console.error(`error: ${(error as Error).message}`); return 1; }
    console.error(`Report written to ${args.output}`);
  } else {
    console.log(text);
  }
  return 0;
}

const VERSION_FALLBACK = "0.0.0";

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json").version as string;
  } catch { return VERSION_FALLBACK; }
}
