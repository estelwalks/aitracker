/**
 * Static tool-definition whitelist. Every built-in tool config is imported
 * here explicitly - never scan the directory or dynamic-import based on user
 * input. Order matches the frozen baseline (UI order); the registry preserves
 * this order in `listTools()` / `getPublicTools()`.
 *
 * To add a tool: create `tools/<id>.config.ts`, add its default import here.
 */
import type { ToolDefinition } from "../contracts.ts";

import claudeCode from "./claude-code.config.ts";
import codex from "./codex.config.ts";
import cursor from "./cursor.config.ts";
import kiro from "./kiro.config.ts";
import geminiCli from "./gemini-cli.config.ts";
import opencode from "./opencode.config.ts";
import openclaw from "./openclaw.config.ts";
import everyCode from "./every-code.config.ts";
import hermes from "./hermes.config.ts";
import githubCopilot from "./github-copilot.config.ts";
import kimiCode from "./kimi-code.config.ts";
import omp from "./omp.config.ts";
import codebuddy from "./codebuddy.config.ts";
import workbuddy from "./workbuddy.config.ts";
import grok from "./grok.config.ts";
import kiloCli from "./kilo-cli.config.ts";
import kilocode from "./kilocode.config.ts";
import antigravity from "./antigravity.config.ts";
import pi from "./pi.config.ts";
import craft from "./craft.config.ts";
import rooCode from "./roo-code.config.ts";
import zed from "./zed.config.ts";
import goose from "./goose.config.ts";
import droid from "./droid.config.ts";
import mimo from "./mimo.config.ts";
import zcode from "./zcode.config.ts";
import anythingllm from "./anythingllm.config.ts";
import aipy from "./aipy.config.ts";
import cline from "./cline.config.ts";

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  claudeCode,
  codex,
  cursor,
  kiro,
  geminiCli,
  opencode,
  openclaw,
  everyCode,
  hermes,
  githubCopilot,
  kimiCode,
  omp,
  codebuddy,
  workbuddy,
  grok,
  kiloCli,
  kilocode,
  antigravity,
  pi,
  craft,
  rooCode,
  zed,
  goose,
  droid,
  mimo,
  zcode,
  anythingllm,
  // Legacy collection sources (catalogVisible=false): real usage sources that
  // are not part of the 27-tool product catalog (docs §6).
  aipy,
  cline,
];
