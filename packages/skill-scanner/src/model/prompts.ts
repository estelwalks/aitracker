import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ModelPrompts {
  single: string;
  multi: string;
  ruleReview: string;
  dedup: string;
  agentSystem: string;
  agentTask: (fileListJson: string) => string;
  shapeFindings: string;
  shapeVerifications: string;
  shapeDedup: string;
}

/**
 * Prompt resources live in src/model/prompts:
 *   - `*.md`    — English prompts (ACTIVE; used for detection)
 *   - `*.zh.md` — Chinese originals from the knownsec-skill-scanner reference project (kept for reference, not used at runtime)
 */
const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");

function readPrompt(file: string): string {
  return readFileSync(join(PROMPT_DIR, file), "utf-8").trimEnd();
}

/** Path (within the scanned file set) the behavioral agent can consult for the reference attack-pattern library. */
export const ATTACK_PATTERNS_PATH = "skill-check/references/attack_patterns.md";
/** Content of the reference attack-pattern library, served to the behavioral agent as a readable file. */
export const ATTACK_PATTERNS_CONTENT = readPrompt("attack_patterns.md");

/** Renders file contents as a readable text blob for single-shot analysis (matching the reference prompt's inline-content expectation). */
export function formatFilesForPrompt(files: Array<{ path: string; content: string }>): string {
  return files.map((file) => `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join("\n\n");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((line) => `${pad}${line}`).join("\n");
}

/** Renders findings as a numbered verification list (matching the reference `_format_findings`), each with the hit's context. */
export function formatFindingsForVerification(findings: Array<{ ruleId?: string; ruleName: string; path: string; line?: number; message: string; excerpt?: string; context: string }>): string {
  return findings.map((f, index) =>
    `[${index}] rule_id=${f.ruleId ?? "model"}\n` +
    `    rule_name=${f.ruleName}\n` +
    `    file=${f.path}:${f.line ?? 0}\n` +
    `    description=${f.message}\n` +
    `    snippet:\n${indent(f.excerpt ?? "", 8)}\n` +
    `    context:\n${indent(f.context, 8)}`,
  ).join("\n\n");
}

const DEDUP_PROMPT = "Determine whether rule hits in the 'secondary' list describe the same risk as model findings in the 'primary' list (same file, same risk point; adjacent lines allowed). Return only the indices of secondary items that duplicate primary; empty array [] if none.";

/**
 * Behavioral-agent JSON protocol injected by this framework (the reference prompt leaves the tool
 * protocol to the hosting framework). English to match the translated reference prompts.
 */
const AGENT_PROTOCOL = `# Tool-call protocol (enforced by this framework)
Output exactly one line of STRICT JSON per turn, one of:
- Call a tool: {"type":"tool_call","tool":"list_files"|"read_file"|"grep","args":{...}}
    list_files: args={} (no args; list all files)
    read_file: args={path,start?,limit?} (path required; limit ≤ 500)
    grep: args={pattern,path?} (regex search; up to 30 matches)
- Finish analysis: {"type":"final","risk_found":<bool>,"findings":[<BehavioralRiskItem>]}
    BehavioralRiskItem = {"index","category","severity","file_path","line_number","name","name_zh","description","description_zh","remediation","remediation_zh","reasoning"}
Do not output anything else; do not use markdown code fences.`;

/** Builds the model prompts. The analysis prompts (single/multi/ruleReview/agentSystem) are English translations of the
 * knownsec-skill-scanner reference prompts loaded from src/model/prompts; dedup and the agent task/protocol are ours. */
export function buildModelPrompts(): ModelPrompts {
  const behavioral = readPrompt("behavioral_analysis_system.md");
  return {
    single: readPrompt("single_file_analysis_system.md"),
    multi: behavioral,
    ruleReview: readPrompt("rules_verify_system.md"),
    dedup: DEDUP_PROMPT,
    agentSystem: behavioral,
    agentTask: (fileListJson: string) =>
      `Perform a behavioral security analysis of the following SKILL directory to find security risks that static rules cannot detect.\n` +
      `SKILL file list (with line counts):\n${fileListJson}\n\n` +
      `An attack-pattern library is available at ${ATTACK_PATTERNS_PATH}; consult it via read_file or grep.\n\n` +
      AGENT_PROTOCOL,
    shapeFindings: `{risk_found:<bool>,findings:[{index,category,severity,file_path,line_number,name,name_zh,description,description_zh,remediation,remediation_zh,reasoning}]}`,
    shapeVerifications: "{verifications:[{index,is_true_positive,reasoning}]}",
    shapeDedup: "{duplicateRuleIndices:[number]}",
  };
}
