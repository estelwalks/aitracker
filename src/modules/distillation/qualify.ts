/**
 * Automatic quality check ("Quality Checker") after generation: on the distillation product (Skill folder / Prompt package /
 * Workflow document) performs programmatic verification according to the rules of SKILL_PROMPT, instead of relying solely on model self-checking.
 * Pure function, no side effects, convenient for single testing and front-end and back-end sharing.
 *
 * Grading caliber:
 * - error: hard problem (missing frontmatter, oversized, SKILL.md contains unfinished mark, empty file),
 *   Failure to pass any one of them means the entire test is "failed".
 * - warn: soft suggestions (description length/keywords/general words, scripts/decision-making, script fault tolerance, etc.),
 *   Only prompts and does not judge failure to prevent legitimate products from being rejected by one vote.
 */
export interface SkillQualificationCheck {
  readonly id: string;
  readonly label: string;
  readonly pass: boolean;
  readonly severity: "error" | "warn";
  /** The specific reason for failure (shown to the user). */
  readonly detail?: string;
}

export interface SkillQualification {
  readonly pass: boolean;
  readonly checks: readonly SkillQualificationCheck[];
}

/** Execution/operation class description keyword (hits ≥2 → scripts/ required). */
const EXECUTION_KEYWORDS = [
  "自动化",
  "脚本",
  "执行",
  "运行",
  "部署",
  "扫描",
  "生成",
  "创建",
  "api",
  "浏览器",
  "上传",
  "下载",
  "转换",
  "构建",
  "安装",
  "提取",
  "编译",
  "获取",
  "发送",
  "automat",
  "script",
  "execute",
  "run",
  "deploy",
  "scan",
  "generate",
  "create",
  "upload",
  "download",
  "install",
  "fetch",
  "post",
  "send",
  "convert",
  "extract",
  "build",
  "compile",
];

/** description General words to avoid (recommendation level). */
const FORBIDDEN_GENERIC = [
  "所有",
  "任何",
  "任意",
  "everything",
  "anything",
  "all kinds",
  "whatever",
];

/** Incomplete mark. */
const UNFINISHED_MARKERS = ["TODO", "FIXME", "HACK", "XXX"];

const MAX_SKILL_BYTES = 8 * 1024;

function hanziCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
}

function englishLetterCount(text: string): number {
  return (text.match(/[A-Za-z]/gu) ?? []).length;
}

export function countExecutionKeywords(description: string): number {
  const lower = description.toLowerCase();
  return EXECUTION_KEYWORDS.filter((keyword) =>
    lower.includes(keyword.toLowerCase()),
  ).length;
}

function parseFrontmatter(skillMd: string): Record<string, string> {
  const match = /^---\s*\n([\s\S]*?)\n---/u.exec(skillMd);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    result[line.slice(0, sep).trim().toLowerCase()] = line
      .slice(sep + 1)
      .trim();
  }
  return result;
}

export interface DistilledSkillFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Generate file construction for side-pocket quality inspection: convert the original output of the model into a "file set" for `qualifySkillFiles`
 * Check. Maintains the same caliber as UI's buildSkillFiles (skill parses `<file>` tag;
 * prompt/brief uses summary as PROMPT/WORKFLOW text).
 */
export function buildFilesForQualification(
  summary: string,
  kind: "skill" | "prompt" | "brief",
  descriptionHint = "蒸馏产物",
): DistilledSkillFile[] {
  if (kind === "skill") {
    const parsed = [
      ...summary.matchAll(
        /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/giu,
      ),
    ]
      .map((match) => ({
        path: match[1]!.trim(),
        content: match[2]!.trim(),
      }))
      .filter((file) => file.path.length > 0 && file.content.length > 0);
    if (parsed.some((file) => file.path.toLowerCase() === "skill.md"))
      return parsed;
    // SKILL.md is not parsed → the entire summary is regarded as content, and the frontmatter check will naturally fail.
    // This triggers a retry.
    return [{ path: "SKILL.md", content: summary }];
  }
  const docPath = kind === "brief" ? "WORKFLOW.md" : "PROMPT.md";
  return [
    {
      path: "SKILL.md",
      content: `---\nname: Distilled\ndescription: ${descriptionHint}\n---\n# Distilled\n`,
    },
    { path: docPath, content: summary },
  ];
}

/**
 * Conduct quality inspection on a set of product documents. `kind` determines which rules apply:
 * - skill: complete SKILL_PROMPT rules (description length/keywords, scripts/decisions, etc.)
 * - prompt/brief: structure rules (frontmatter, volume, no unfinished mark, file is not empty)
 */
export function qualifySkillFiles(
  files: readonly { path: string; content: string }[],
  kind: "skill" | "prompt" | "brief",
): SkillQualification {
  // Quality inspection is all-encompassing: any abnormality will be returned by pressing "Pass", errors will never be thrown, and quality inspection will never blow up the main process.
  // As long as the results are returned, the quality inspection will only provide users with reference on the normal path.
  try {
    return qualifySkillFilesInner(files, kind);
  } catch {
    return { pass: true, checks: [] };
  }
}

function qualifySkillFilesInner(
  files: readonly { path: string; content: string }[],
  kind: "skill" | "prompt" | "brief",
): SkillQualification {
  // Defense: Very large products/too many files will be directly judged as unqualified and returned to avoid doing so on the rendering/save path.
  // Unnecessary heavy-duty processing (quality inspection is a pure function, there is no infinite loop, this is just to prevent "stuck").
  const totalBytes = files.reduce(
    (sum, file) => sum + new TextEncoder().encode(file.content).byteLength,
    0,
  );
  if (files.length > 200 || totalBytes > 10 * 1024 * 1024) {
    return {
      pass: false,
      checks: [
        {
          id: "size-cap",
          label: "产物规模在合理范围内",
          pass: false,
          severity: "error",
          detail: `${files.length} 个文件 / ${Math.round(totalBytes / 1024 / 1024)}MB`,
        },
      ],
    };
  }

  const skillFile = files.find(
    (file) => file.path.toLowerCase() === "skill.md",
  );
  const scriptFiles = files.filter((file) =>
    file.path.toLowerCase().startsWith("scripts/"),
  );
  const checks: SkillQualificationCheck[] = [];

  const push = (
    id: string,
    label: string,
    pass: boolean,
    severity: "error" | "warn",
    detail?: string,
  ) => checks.push({ id, label, pass, severity, detail });

  if (!skillFile) {
    push(
      "frontmatter",
      "包含 SKILL.md 与 YAML frontmatter",
      false,
      "error",
      "缺少 SKILL.md 文件",
    );
    return { pass: false, checks };
  }

  const frontmatter = parseFrontmatter(skillFile.content);
  const hasFrontmatter =
    Object.keys(frontmatter).length > 0 &&
    Boolean(frontmatter.name) &&
    Boolean(frontmatter.description);
  push(
    "frontmatter",
    "SKILL.md 含 name / description frontmatter",
    hasFrontmatter,
    "error",
    hasFrontmatter ? undefined : "frontmatter 缺少 name 或 description",
  );

  const description = frontmatter.description ?? "";
  const descLen = description.trim().length;
  let needsScripts = false;
  if (kind === "skill") {
    push(
      "desc-length",
      "description 长度 50–300 字符（建议）",
      descLen >= 50 && descLen <= 300,
      "warn",
      `${descLen} 字符`,
    );
  } else {
    push(
      "desc-present",
      "description 已提供",
      descLen > 0,
      "error",
      descLen > 0 ? undefined : "description 为空",
    );
  }

  if (kind === "skill") {
    const hanzi = hanziCount(description);
    const letters = englishLetterCount(description);
    const hasKeywords = hanzi >= 2 && letters >= 3;
    push(
      "desc-keywords",
      "description 含中英文关键词（建议）",
      hasKeywords,
      "warn",
      `中文 ${hanzi} 字 / 英文 ${letters} 字母`,
    );

    const generic = FORBIDDEN_GENERIC.filter((word) =>
      description.toLowerCase().includes(word),
    );
    push(
      "desc-generic",
      "description 避免泛化词（建议）",
      generic.length === 0,
      "warn",
      generic.length > 0 ? `命中泛化词：${generic.join("、")}` : undefined,
    );

    const executionHits = countExecutionKeywords(description);
    needsScripts = executionHits >= 2;
    const scriptOk = needsScripts
      ? scriptFiles.some((file) => file.content.trim().length > 10)
      : scriptFiles.length === 0;
    push(
      "scripts-decision",
      needsScripts
        ? "执行类任务提供非空 scripts/（建议）"
        : "知识/指导类不含 scripts/（建议）",
      scriptOk,
      "warn",
      scriptOk
        ? undefined
        : needsScripts
          ? `description 命中 ${executionHits} 个执行关键词，但 scripts/ 为空或缺失`
          : `description 命中 ${executionHits} 个执行关键词，不应创建 scripts/`,
    );
  }

  const size = new TextEncoder().encode(skillFile.content).byteLength;
  push(
    "size",
    "SKILL.md 体积 ≤ 8KB",
    size <= MAX_SKILL_BYTES,
    "error",
    `${Math.round(size / 1024)}KB`,
  );

  // The unfinished marks in SKILL.md are hard questions; the ones in references/scripts are only suggestions.
  const skillUnfinished = UNFINISHED_MARKERS.filter((marker) =>
    skillFile.content.includes(marker),
  ).slice(0, 3);
  push(
    "no-todo",
    "SKILL.md 无 TODO/FIXME/HACK/XXX",
    skillUnfinished.length === 0,
    "error",
    skillUnfinished.length > 0 ? skillUnfinished.join("、") : undefined,
  );
  const otherUnfinished = files
    .filter((file) => file.path.toLowerCase() !== "skill.md")
    .flatMap((file) =>
      UNFINISHED_MARKERS.filter((marker) => file.content.includes(marker)).map(
        (marker) => `${marker}@${file.path}`,
      ),
    )
    .slice(0, 3);
  push(
    "no-todo-other",
    "其他文件无未完成标记（建议）",
    otherUnfinished.length === 0,
    "warn",
    otherUnfinished.length > 0 ? otherUnfinished.join("、") : undefined,
  );

  if (kind === "skill" && needsScripts) {
    const pythonFiles = scriptFiles.filter((file) => /\.py$/i.test(file.path));
    const shellFiles = scriptFiles.filter((file) =>
      /\.(sh|bash|zsh)$/i.test(file.path),
    );
    const pythonOk = pythonFiles.every((file) => /try\s*:/u.test(file.content));
    const shellOk = shellFiles.every((file) =>
      /set\s+-euo\s+pipefail/u.test(file.content),
    );
    push(
      "scripts-robust",
      "脚本容错（Python try/except、Shell set -euo pipefail，建议）",
      pythonOk && shellOk,
      "warn",
      !pythonOk
        ? "存在缺少 try/except 的 Python 脚本"
        : !shellOk
          ? "存在缺少 set -euo pipefail 的 Shell 脚本"
          : undefined,
    );
  }

  const emptyFiles = files.filter((file) => file.content.trim().length === 0);
  push(
    "files-nonempty",
    "产物文件均非空",
    emptyFiles.length === 0,
    "error",
    emptyFiles.length > 0
      ? `空文件：${emptyFiles.map((f) => f.path).join("、")}`
      : undefined,
  );

  const pass = checks.every((check) => check.pass || check.severity === "warn");
  return { pass, checks };
}
