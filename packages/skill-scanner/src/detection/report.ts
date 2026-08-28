import { format, getMessages } from "../i18n/index.js";
import { normalizeKind, normalizeSeverity, redact } from "../model/normalize.js";
import { LLM_SEVERITY_WEIGHTS } from "../types.js";
import { SEVERITY_RANK } from "./scoring.js";
import type { Finding, LocaleKey, ScanSkillReport, SkillFile } from "../types.js";
import type { BehavioralRiskItem } from "../model/client.js";

/** Normalizes raw behavioral-model findings into Finding (category/severity mapped to slugs, bilingual copy picked by locale). */
export function asFindings(items: BehavioralRiskItem[], files: SkillFile[], phase: string, locale: LocaleKey, fileHashes: ReadonlyMap<string, string> = new Map()): Finding[] {
  const m = getMessages(locale);
  const validPaths = new Set(files.map((file) => file.path)); const fallback = files[0]?.path ?? "SKILL.md";
  const zh = locale === "zh-CN";
  const output: Finding[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const kind = normalizeKind(item.category);
    if (!kind) continue;
    const severity = normalizeSeverity(item.severity);
    const path = item.file_path ? (validPaths.has(item.file_path) ? item.file_path : null) : fallback;
    if (!path) continue; // finding references a non-scanned file (e.g. the attack-patterns reference) → drop
    const fileHash = fileHashes.get(path);
    output.push({
      id: `model:${phase}:${index}`, kind, severity, source: "model",
      kindDisplay: m.kind[kind], severityDisplay: m.severity[severity],
      ruleName: item.name || m.modelRuleName,
      message: redact(zh ? (item.description_zh || item.description) : item.description),
      remediation: zh ? (item.remediation_zh || item.remediation) : item.remediation,
      reasoning: item.reasoning || undefined,
      weight: LLM_SEVERITY_WEIGHTS[severity], path, ...(fileHash ? { fileHash } : {}),
      ...(item.line_number > 0 ? { line: item.line_number } : {}),
    });
  }
  return output;
}

/** Code context of ±2 lines around the hit line, for ruleReview to judge false positives (in-memory slice, no disk reads). */
export function buildContext(files: SkillFile[], path: string, line?: number): string {
  if (!line) return "";
  const file = files.find((f) => f.path === path);
  if (!file) return "";
  const lines = file.content.split(/\r?\n/);
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  return lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l.length > 200 ? `${l.slice(0, 200)}...` : l}`).join("\n");
}

export function buildCategories(findings: Finding[], locale: LocaleKey): ScanSkillReport["categories"] {
  const m = getMessages(locale);
  const buckets: ScanSkillReport["categories"] = {};
  const countedRules = new Set<string>();
  for (const item of findings) {
    const bucket = buckets[item.kind] ??= { count: 0, highestSeverity: "low" as const, totalWeight: 0, display: m.kind[item.kind] };
    bucket.count += 1;
    if (item.source === "model" || !item.ruleId || !countedRules.has(item.ruleId)) {
      bucket.totalWeight += item.weight ?? 0;
      if (item.source === "static" && item.ruleId) countedRules.add(item.ruleId);
    }
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[bucket.highestSeverity]) bucket.highestSeverity = item.severity;
  }
  return buckets;
}

/** Aggregates static findings by rule_id (aligns with knownsec findings.rules: match_count + matches list). */
export function buildRuleAggregations(ruleFindings: Finding[], locale: LocaleKey): ScanSkillReport["rules"] {
  const m = getMessages(locale);
  const groups = new Map<string, { ruleId: string; ruleName: string; kind: Finding["kind"]; severity: Finding["severity"]; weight: number; cweId?: string; matches: Array<{ path: string; line?: number; excerpt?: string }> }>();
  for (const f of ruleFindings) {
    if (!f.ruleId) continue;
    let g = groups.get(f.ruleId);
    if (!g) { g = { ruleId: f.ruleId, ruleName: m.ruleName[f.ruleId] ?? f.ruleName, kind: f.kind, severity: f.severity, weight: f.weight ?? 0, ...(f.cweId ? { cweId: f.cweId } : {}), matches: [] }; groups.set(f.ruleId, g); }
    g.matches.push({ path: f.path, ...(f.line ? { line: f.line } : {}), ...(f.excerpt ? { excerpt: f.excerpt } : {}), ...(f.fileHash ? { fileHash: f.fileHash } : {}) });
  }
  return [...groups.values()].sort((a, b) => b.weight - a.weight).map((g) => ({ ...g, count: g.matches.length }));
}

/** Localized summary: generates exactly one, in the requested locale. */
export function buildSummary(scannedFiles: number, findings: Finding[], locale: LocaleKey): string {
  const m = getMessages(locale);
  if (findings.length === 0) return format(m.summary.clean, { count: scannedFiles });
  const cats = [...new Set(findings.map((f) => f.kindDisplay))];
  const catStr = cats.slice(0, 3).join(m.summary.listSeparator) + (cats.length > 3 ? `${m.summary.listSeparator}…` : "");
  const sevParts: string[] = [];
  for (const sev of ["critical", "high", "medium", "low"] as const) {
    const count = findings.filter((f) => f.severity === sev).length;
    if (count > 0) sevParts.push(format(m.summary.sevItem, { count, label: m.severity[sev] }));
  }
  return format(m.summary.found, { count: scannedFiles, cats: catStr, sevText: sevParts.join(m.summary.listSeparator) });
}
