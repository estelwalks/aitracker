#!/usr/bin/env node
// Full-scan driver: reads model config from environment variables and scans a SKILL directory.
// This script is a HOST of the library (it reads disk content into memory); the library itself
// stays in-memory and never opens paths on its own.
//
// OpenAI Responses (endpoint = base URL, /responses appended):
//   LLM_PROVIDER=openai-responses LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
//   LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
//   node examples/run-full-scan.mjs /path/to/skill_dir
//
// OpenAI-compatible Chat Completions (OpenAI / DeepSeek / vLLM / Ollama ... endpoint = base URL, /chat/completions appended):
//   LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
//   LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
//   node examples/run-full-scan.mjs /path/to/skill_dir
//
// Anthropic Messages API (endpoint = https://api.anthropic.com/v1, /messages appended):
//   LLM_PROVIDER=anthropic LLM_ENDPOINT=https://api.anthropic.com/v1 LLM_API_KEY=sk-ant-... \
//   LLM_LITE_MODEL=claude-sonnet-5 LLM_PRO_MODEL=claude-opus-5 \
//   node examples/run-full-scan.mjs /path/to/skill_dir
//
// Optional: LLM_TIMEOUT_MS (default 120000), LLM_CONTEXT_WINDOW_TOKENS (raise the model
// content budget, e.g. 1000000 for a 1M-token model), LLM_MAX_AGENT_TURNS (behavioral agent
// tool-call budget, default 12), LLM_LOCALE (zh-CN|en-US|ja-JP|ko-KR, default zh-CN).
// Without model env vars (or with a trailing --quick) it runs a STATIC-ONLY quick scan.

import fs from "node:fs";
import path from "node:path";
import { scanSkill } from "../dist/index.js";

const target = process.argv[2];
if (!target) {
  console.error("Missing target directory. Usage: node examples/run-full-scan.mjs <skill-dir>");
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`Target does not exist: ${target}`);
  process.exit(1);
}

const hasModel = ["LLM_ENDPOINT", "LLM_API_KEY", "LLM_LITE_MODEL", "LLM_PRO_MODEL"].every((key) => process.env[key]);
const forceQuick = process.argv.includes("--quick");
const model = hasModel ? {
  ...(process.env.LLM_PROVIDER ? { provider: process.env.LLM_PROVIDER } : {}),
  endpoint: process.env.LLM_ENDPOINT,
  apiKey: process.env.LLM_API_KEY,
  liteModel: process.env.LLM_LITE_MODEL,
  proModel: process.env.LLM_PRO_MODEL,
  ...(process.env.LLM_TIMEOUT_MS ? { timeoutMs: Number(process.env.LLM_TIMEOUT_MS) } : {}),
  ...(process.env.LLM_CONTEXT_WINDOW_TOKENS ? { contextWindowTokens: Number(process.env.LLM_CONTEXT_WINDOW_TOKENS) } : {}),
  ...(process.env.LLM_MAX_AGENT_TURNS ? { maxAgentTurns: Number(process.env.LLM_MAX_AGENT_TURNS) } : {}),
} : null;

const files = [];
for (const file of walk(target)) {
  const buf = fs.readFileSync(file);
  const isBinary = buf.includes(0);
  files.push({ path: path.relative(target, file), content: buf.toString("utf-8"), ...(isBinary ? { isBinary: true } : {}) });
}
if (!files.some((f) => /SKILL\.md$/.test(f.path))) console.warn("Warning: no SKILL.md found in target directory");

const mode = forceQuick || !model ? "quick" : "full";
if (!model) console.error("LLM env vars missing; running STATIC-ONLY quick scan (set LLM_ENDPOINT/LLM_API_KEY/LLM_LITE_MODEL/LLM_PRO_MODEL for full).");
else if (forceQuick) console.error("--quick: skipping LLM analysis, static-only.");
console.error(`Scanning ${files.length} file(s) in ${target} as ${mode === "quick" ? "quick(static-only)" : `full(provider=${model.provider ?? "auto"})`}...`);
const report = await scanSkill({ mode, locale: process.env.LLM_LOCALE || "zh-CN", files, ...(model ? { model } : {}) });
console.log(JSON.stringify({
  status: report.status,
  verdict: report.verdict,
  riskScore: report.riskScore,
  threatLevel: report.threatLevel,
  threatLevelDisplay: report.threatLevelDisplay,
  locale: report.locale,
  contentHash: report.contentHash,
  scannedFiles: report.scannedFiles,
  summary: report.summary,
  branches: report.branches,
  categories: report.categories,
  findings: report.findings,
  rules: report.rules,
  skippedFiles: report.skippedFiles,
}, null, 2));

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
