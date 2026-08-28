import { createHash } from "node:crypto";
import { basename } from "node:path";
import { ENGINE_VERSION, RULES_VERSION } from "./rules/index.js";
import { staticScan } from "./detection/staticScan.js";
import { fileLevelScan } from "./detection/fileChecks.js";
import { asFindings, buildCategories, buildContext, buildRuleAggregations, buildSummary } from "./detection/report.js";
import { computeScore, threatLevelOf, verdictOf } from "./detection/scoring.js";
import { dedupByLocation, semanticDedup } from "./detection/dedup.js";
import { ModelResponseSchema, RuleVerificationSchema, askModel, capFilesForModel } from "./model/client.js";
import type { BehavioralRiskItem } from "./model/client.js";
import { runBehavioralAgent } from "./model/agent.js";
import { ATTACK_PATTERNS_CONTENT, ATTACK_PATTERNS_PATH, buildModelPrompts, formatFilesForPrompt, formatFindingsForVerification } from "./model/prompts.js";
import { redact } from "./model/normalize.js";
import { TokenUsageCollector } from "./model/usage.js";
import { getMessages } from "./i18n/index.js";
import { collectPaths, isSafePath, isSafeRelativePath } from "./input.js";
import { ScanSkillReportSchema, ScanSkillRequestSchema, type Finding, type ScanDependencies, type ScanSkillReport, type SkillFile } from "./types.js";

function validateFiles(inputFiles: SkillFile[], detectContentNul = true, allowDiskPaths = false): { files: SkillFile[]; skipped: ScanSkillReport["skippedFiles"] } {
  const paths = new Set<string>(); const files: SkillFile[] = []; const skipped: ScanSkillReport["skippedFiles"] = [];
  for (const file of inputFiles) {
    if (!(allowDiskPaths ? isSafePath(file.path) : isSafeRelativePath(file.path))) throw new Error(`Invalid relative file path: ${JSON.stringify(file.path)}`);
    if (paths.has(file.path)) throw new Error(`Duplicate relative file path: ${JSON.stringify(file.path)}`);
    paths.add(file.path);
    if (file.isBinary || (detectContentNul && file.content.includes("\0"))) skipped.push({ path: file.path, reason: "binary file was not scanned" });
    else files.push(file);
  }
  return { files, skipped };
}

/** Hashes the sorted (path, content) pairs to build a language-isolated cache key. */
function contentHash(inputFiles: SkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...inputFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path).update("\0").update(file.content);
  }
  return hash.digest("hex");
}

/** Hashes a single file's (path, content) pair to build a content-addressed file identifier. */
function hashFile(file: { path: string; content: string }): string {
  const hash = createHash("sha256");
  hash.update(file.path).update("\0").update(file.content);
  return hash.digest("hex");
}

/** Scans in-memory `files` or disk `paths`; it never persists API keys or executes Skill code. */
export async function scanSkill(input: unknown, dependencies: ScanDependencies = {}): Promise<ScanSkillReport> {
  const request = ScanSkillRequestSchema.parse(input);
  const locale = request.locale;
  const messages = getMessages(locale);
  const prompts = buildModelPrompts();
  const log = dependencies.log;
  const usageCollector = new TokenUsageCollector();
  log?.(`scan: locale=${locale} mode=${request.mode}`);
  const diskInput = request.files
    ? {
        files: request.files,
        excludedFiles: [] as SkillFile[],
        analysisPaths: request.files.map((file) => file.path),
        singleSkillFile: request.files.length === 1 && !request.files[0].isBinary && basename(request.files[0].path) === "SKILL.md",
        skipped: [] as ScanSkillReport["skippedFiles"],
      }
    : await collectPaths(request.paths!);
  const allInputFiles = [...diskInput.files, ...diskInput.excludedFiles];
  const validated = validateFiles(diskInput.files, Boolean(request.files), Boolean(request.paths));
  const analysisPaths = new Set(diskInput.analysisPaths);
  const files = validated.files.filter((file) => analysisPaths.has(file.path));
  const skipped = validated.skipped;
  const allSkipped = [...new Map([...diskInput.skipped, ...skipped].map((item) => [`${item.path}\0${item.reason}`, item])).values()];
  const fileHashes = new Map<string, string>();
  for (const file of allInputFiles) fileHashes.set(file.path, hashFile(file));
  const singleSkillFile = diskInput.singleSkillFile;
  let findings: Finding[] = [...staticScan(files, locale, fileHashes), ...fileLevelScan(allInputFiles, files, locale, fileHashes)];
  log?.(`input: ${allInputFiles.length} file(s)${request.paths ? ` from ${request.paths.length} path(s)` : " (in-memory)"}, ${allSkipped.length} skipped`);
  log?.(`static: ${findings.length} finding(s) from static rules and file checks`);
  const branches: ScanSkillReport["branches"] = [{ name: "static", status: "complete" }]; let partial = allSkipped.length > 0;
  if (request.mode === "full") {
    if (!request.model) {
      partial = true; branches.push({ name: "ruleReview", status: "skipped", detail: "model configuration is required for full scan" }, { name: "singleFileAnalysis", status: "skipped", detail: "model configuration is required for full scan" }, { name: "multiFileAnalysis", status: "skipped", detail: "model configuration is required for full scan" });
    } else {
      const fetcher = dependencies.fetch ?? globalThis.fetch;
      if (!fetcher) { partial = true; log?.("model: fetch is unavailable, model branches failed"); for (const name of ["ruleReview", "singleFileAnalysis", "multiFileAnalysis"] as const) branches.push({ name, status: "failed", detail: "fetch is unavailable" }); }
      else {
        log?.(`model: provider=${request.model.provider ?? "auto"} lite=${request.model.liteModel} pro=${request.model.proModel}`);
        // 1) ruleReview: verify each static hit individually and drop false positives; bypass hits (IOC/file-level) are kept as-is
        const bypassed = findings.filter((f) => f.bypassVerification);
        const toVerify = findings.filter((f) => !f.bypassVerification);
        log?.(`ruleReview: verifying ${toVerify.length} static hit(s)`);
        if (toVerify.length === 0) {
          branches.push({ name: "ruleReview", status: "complete" });
        } else {
          try {
            const ruleReviewList = formatFindingsForVerification(toVerify.map((f) => ({ ruleId: f.ruleId, ruleName: f.ruleName, path: f.path, line: f.line, message: f.message, excerpt: f.excerpt, context: buildContext(files, f.path, f.line) })));
            const ruleReviewTask = `Please verify each of the following rule hits for whether it is a real risk. The context around each hit (±2 lines) is provided; no file reads are needed. Output strict JSON per the schema.\n\nHit list:\n${ruleReviewList}`;
            const veri = await askModel(fetcher, request.model, request.model.liteModel, ruleReviewTask, "", prompts.shapeVerifications, RuleVerificationSchema, prompts.ruleReview, { collector: usageCollector, context: { model: request.model.liteModel, branch: "ruleReview" } });
            const decisions = new Map(veri.verifications.map((item) => [item.index, item.is_true_positive]));
            findings = [...bypassed, ...toVerify.filter((_, index) => decisions.get(index) !== false)];
            branches.push({ name: "ruleReview", status: "complete" });
          } catch (error) {
            partial = true; branches.push({ name: "ruleReview", status: "failed", detail: redact(error instanceof Error ? error.message : "unknown model error") });
          }
        }
        log?.(`ruleReview: ${findings.length} finding(s) after verification`);
        // 2) Reference dynamic route: exactly one SKILL.md uses single-file analysis; all other inputs use the behavioral agent.
        const results: Array<{ name: "singleFileAnalysis" | "multiFileAnalysis"; findings?: BehavioralRiskItem[]; error?: string }> = [];
        if (singleSkillFile) {
          branches.push({ name: "multiFileAnalysis", status: "skipped", detail: "single SKILL.md input" });
          const skillFiles = capFilesForModel(files, request.model);
          log?.(`singleFileAnalysis: analyzing ${skillFiles.length} file(s) with ${request.model.proModel}`);
          const singleTask = "Perform a behavioral security analysis of the following SKILL content to find security risks that static rules cannot detect. Output strict JSON per the schema; do not use markdown code fences.\nBelow is the content:\n\n";
          try {
            const response = await askModel(fetcher, request.model, request.model.proModel, singleTask, formatFilesForPrompt(skillFiles), prompts.shapeFindings, ModelResponseSchema, prompts.single, { collector: usageCollector, context: { model: request.model.proModel, branch: "singleFileAnalysis" } });
            results.push({ name: "singleFileAnalysis", findings: response.findings });
          } catch (error) {
            results.push({ name: "singleFileAnalysis", error: error instanceof Error ? error.message : "unknown model error" });
          }
        } else {
          branches.push({ name: "singleFileAnalysis", status: "skipped", detail: "multi-file input" });
          log?.(`multiFileAnalysis: running behavioral agent with ${request.model.proModel}`);
          const agentFiles: SkillFile[] = [...files, { path: ATTACK_PATTERNS_PATH, content: ATTACK_PATTERNS_CONTENT, isBinary: false }];
          const fileListJson = JSON.stringify(agentFiles.map((f) => ({ path: f.path, lineCount: f.content.split(/\r?\n/).length, chars: f.content.length })));
          const multiTask = "Perform a behavioral security analysis of the following SKILL directory content to find security risks that static rules cannot detect. Output strict JSON per the schema; do not use markdown code fences.\nBelow is the full file content:\n\n";
          try {
            let behavioralFindings: BehavioralRiskItem[];
            try {
              behavioralFindings = await runBehavioralAgent(fetcher, request.model, agentFiles, prompts.agentSystem, prompts.agentTask(fileListJson), usageCollector);
            } catch {
              const response = await askModel(fetcher, request.model, request.model.proModel, multiTask, formatFilesForPrompt(capFilesForModel(files, request.model)), prompts.shapeFindings, ModelResponseSchema, prompts.multi, { collector: usageCollector, context: { model: request.model.proModel, branch: "multiFileAnalysis" } });
              behavioralFindings = response.findings;
            }
            results.push({ name: "multiFileAnalysis", findings: behavioralFindings });
          } catch (error) {
            results.push({ name: "multiFileAnalysis", error: error instanceof Error ? error.message : "unknown model error" });
          }
        }
        const modelFindings: Finding[] = [];
        for (const result of results) {
          if (result.error) { partial = true; branches.push({ name: result.name, status: "failed", detail: redact(result.error) }); log?.(`${result.name}: failed`); }
          else { branches.push({ name: result.name, status: "complete" }); modelFindings.push(...asFindings(result.findings ?? [], files, result.name, locale, fileHashes)); log?.(`${result.name}: ${result.findings?.length ?? 0} finding(s)`); }
        }
        // 3) Reference location dedup runs within each side before semantic dedup.
        const locationDeduped = dedupByLocation(findings, modelFindings);
        const verifiedStatic = locationDeduped.rules;
        const modelDeduped = locationDeduped.model;
        log?.(`dedup: location dedup kept ${modelDeduped.length} of ${modelFindings.length} model finding(s)`);
        // 4) Semantic dedup compares every retained rule finding against model findings; model wins on overlap.
        const keptRules = await semanticDedup(fetcher, request.model, verifiedStatic, modelDeduped, usageCollector);
        log?.(`dedup: semantic dedup kept ${keptRules.length} of ${verifiedStatic.length} rule finding(s)`);
        findings = [...keptRules, ...modelDeduped];
      }
    }
  }
  const finalLocationDedup = dedupByLocation(findings.filter((item) => item.source === "static"), findings.filter((item) => item.source === "model"));
  findings = [...finalLocationDedup.rules, ...finalLocationDedup.model];
  const score = computeScore(findings); const level = threatLevelOf(score);
  log?.(`result: riskScore=${score} threatLevel=${level} verdict=${verdictOf(score, partial, findings)} findings=${findings.length} status=${partial ? "partial" : "complete"}`);
  const report = {
    status: partial ? "partial" as const : "complete" as const, mode: request.mode, verdict: verdictOf(score, partial, findings),
    riskScore: score, rulesVersion: RULES_VERSION, engineVersion: ENGINE_VERSION,
    locale, contentHash: contentHash(allInputFiles), scannedFiles: allInputFiles.length,
    threatLevel: level, threatLevelDisplay: messages.threatLevel[level],
    categories: buildCategories(findings, locale), summary: buildSummary(allInputFiles.length, findings, locale),
    findings, rules: buildRuleAggregations(findings.filter((f) => f.source === "static"), locale),
    branches, skippedFiles: allSkipped, tokenUsage: usageCollector.report(),
  };
  return ScanSkillReportSchema.parse(report);
}
