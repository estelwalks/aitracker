import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LocaleSchema, ModelConfigSchema, ProviderSchema, SCAN_MODES } from "../types.js";
import type { LocaleKey, ModelConfig } from "../types.js";
import type { ParsedArgs } from "./args.js";

export interface ResolvedConfig {
  mode: "quick" | "full";
  locale: LocaleKey;
  model: ModelConfig | null;
  /** True when the mode came from an explicit --mode/--quick flag or the config file, not auto-detection. */
  modeExplicit: boolean;
}

export interface ConfigFile {
  mode?: "quick" | "full";
  locale?: LocaleKey;
  model?: Partial<ModelConfig>;
}

const ConfigFileSchema = z.object({
  mode: z.enum(SCAN_MODES).optional(),
  locale: LocaleSchema.optional(),
  model: ModelConfigSchema.partial().optional(),
}).strict();

/** Mirrors examples/run-full-scan.mjs: maps LLM_* env vars onto a partial model config.
 * LLM_PROVIDER accepts openai-responses, openai-completions, anthropic, and the legacy openai alias. */
export function envModel(env: NodeJS.ProcessEnv): Partial<ModelConfig> {
  const m: Partial<ModelConfig> = {};
  if (env.LLM_PROVIDER) { const r = ProviderSchema.safeParse(env.LLM_PROVIDER); if (r.success) m.provider = r.data; }
  if (env.LLM_ENDPOINT) m.endpoint = env.LLM_ENDPOINT;
  if (env.LLM_API_KEY) m.apiKey = env.LLM_API_KEY;
  if (env.LLM_LITE_MODEL) m.liteModel = env.LLM_LITE_MODEL;
  if (env.LLM_PRO_MODEL) m.proModel = env.LLM_PRO_MODEL;
  const timeoutMs = finiteInRange(env.LLM_TIMEOUT_MS, 100, 120_000);
  if (timeoutMs !== undefined) m.timeoutMs = timeoutMs;
  const contextWindowTokens = finiteInRange(env.LLM_CONTEXT_WINDOW_TOKENS, 1, 10_000_000);
  if (contextWindowTokens !== undefined) m.contextWindowTokens = contextWindowTokens;
  const maxAgentTurns = finiteInRange(env.LLM_MAX_AGENT_TURNS, 1, 100);
  if (maxAgentTurns !== undefined) m.maxAgentTurns = maxAgentTurns;
  return m;
}

function finiteInRange(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Reads and validates a JSON config file ({ mode?, locale?, model? }). */
export function readConfigFile(configPath: string): ConfigFile {
  let raw: string;
  try { raw = readFileSync(configPath, "utf-8"); } catch { throw new Error(`cannot read config file: ${configPath}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`invalid JSON in config file: ${configPath}`); }
  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`invalid config file ${configPath}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
  return result.data;
}

export function isModelComplete(model: Partial<ModelConfig>): boolean {
  return Boolean(model.endpoint && model.apiKey && model.liteModel && model.proModel);
}

/** Parses a `.env`-style document into KEY=VALUE pairs (ignores comments, supports quotes and an optional `export` prefix). */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Loads `cwd/.env` into `env` without overriding variables that are already set. */
export function loadDotEnv(env: NodeJS.ProcessEnv, cwd: string): void {
  let text: string;
  try { text = readFileSync(path.join(cwd, ".env"), "utf-8"); } catch { return; }
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
}

/** Merges config per field with precedence: CLI flags > JSON config file > LLM_* env vars. */
export function loadConfig(args: ParsedArgs, env: NodeJS.ProcessEnv, cwd: string): ResolvedConfig {
  const model = envModel(env);
  const configPath = args.config ?? path.join(cwd, ".skill-scanner.json");
  let config: ConfigFile = {};
  if (args.config) {
    config = readConfigFile(configPath);
  } else if (existsSync(configPath)) config = readConfigFile(configPath);
  if (config.model) Object.assign(model, config.model);
  Object.assign(model, args.model);
  const locale = LocaleSchema.parse(args.locale ?? config.locale ?? env.LLM_LOCALE ?? "zh-CN");
  const mode = resolveMode(args, config.mode, model);
  const modeExplicit = Boolean(args.mode || args.quick || config.mode);
  return { mode, locale, model: mode === "full" ? ModelConfigSchema.parse(model) : null, modeExplicit };
}

function resolveMode(args: ParsedArgs, configMode: ConfigFile["mode"], model: Partial<ModelConfig>): "quick" | "full" {
  if (args.quick) return "quick";
  const requested = args.mode ?? configMode;
  if (requested === "quick") return "quick";
  if (requested === "full") {
    if (!isModelComplete(model)) throw new Error("full mode requires endpoint, apiKey, liteModel and proModel");
    return "full";
  }
  return isModelComplete(model) ? "full" : "quick";
}
