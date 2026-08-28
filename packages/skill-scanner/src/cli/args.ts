import { z } from "zod";
import { LocaleSchema, ProviderSchema, PROVIDERS, SCAN_MODES } from "../types.js";
import type { LocaleKey, ModelConfig } from "../types.js";

export class UsageError extends Error {}

export interface ParsedArgs {
  positional?: string;
  config?: string;
  mode?: "quick" | "full";
  quick: boolean;
  locale?: LocaleKey;
  model: Partial<ModelConfig>;
  json: boolean;
  output?: string;
  help: boolean;
  version: boolean;
  verbose: boolean;
}

const timeoutSchema = z.coerce.number().int().min(100).max(120_000);
const contextWindowSchema = z.coerce.number().int().positive().max(10_000_000);
const maxAgentTurnsSchema = z.coerce.number().int().min(1).max(100);

const VALUE_FLAGS = new Set([
  "--config", "--mode", "--locale", "--output",
  "--provider", "--endpoint", "--api-key", "--lite-model", "--pro-model",
  "--timeout-ms", "--context-window-tokens", "--max-agent-turns",
]);

/** Parses argv (without `node`/script) into a typed option object; throws UsageError on invalid input. */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { quick: false, model: {}, json: false, help: false, version: false, verbose: false };
  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (positionalOnly || !token.startsWith("-") || token === "-") {
      if (out.positional !== undefined) throw new UsageError("only one path argument is allowed");
      out.positional = token;
      continue;
    }
    if (token === "--") { positionalOnly = true; continue; }
    if (token === "-h") { out.help = true; continue; }
    if (token === "-v") { out.version = true; continue; }
    const eq = token.indexOf("=");
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    const inline = eq >= 0 ? token.slice(eq + 1) : undefined;
    if (!flag.startsWith("--")) throw new UsageError(`unknown flag: ${token}`);
    if (flag === "--help" || flag === "--version" || flag === "--quick" || flag === "--json" || flag === "--verbose") {
      if (inline !== undefined) throw new UsageError(`flag ${flag} does not take a value`);
      if (flag === "--help") out.help = true;
      else if (flag === "--version") out.version = true;
      else if (flag === "--quick") out.quick = true;
      else if (flag === "--verbose") out.verbose = true;
      else out.json = true;
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      if (inline !== undefined) { applyValueFlagSafely(out, flag, inline); continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) throw new UsageError(`missing value for ${flag}`);
      i += 1;
      applyValueFlagSafely(out, flag, next);
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  return out;
}

/** Converts zod validation failures for flag values into a concise UsageError. */
function applyValueFlagSafely(out: ParsedArgs, flag: string, value: string): void {
  try { applyValueFlag(out, flag, value); }
  catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`invalid value for ${flag}: ${value}`);
  }
}

function applyValueFlag(out: ParsedArgs, flag: string, value: string): void {
  switch (flag) {
    case "--config": out.config = value; return;
    case "--output": out.output = value; return;
    case "--mode": {
      const r = z.enum(SCAN_MODES).safeParse(value);
      if (!r.success) throw new UsageError(`invalid mode: ${value} (expected quick or full)`);
      out.mode = r.data;
      return;
    }
    case "--locale": out.locale = LocaleSchema.parse(value); return;
    case "--provider": {
      const result = ProviderSchema.safeParse(value);
      if (!result.success) throw new UsageError(`invalid provider: ${value} (expected ${PROVIDERS.join(", ")})`);
      out.model.provider = result.data;
      return;
    }
    case "--endpoint": out.model.endpoint = value; return;
    case "--api-key": out.model.apiKey = value; return;
    case "--lite-model": out.model.liteModel = value; return;
    case "--pro-model": out.model.proModel = value; return;
    case "--timeout-ms": out.model.timeoutMs = timeoutSchema.parse(value); return;
    case "--context-window-tokens": out.model.contextWindowTokens = contextWindowSchema.parse(value); return;
    case "--max-agent-turns": out.model.maxAgentTurns = maxAgentTurnsSchema.parse(value); return;
    default: throw new UsageError(`unknown flag: ${flag}`);
  }
}
