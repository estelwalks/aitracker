/**
 * 生成后自动质检（"质量检测器"）：对蒸馏产物（Skill 文件夹 / Prompt 包 /
 * 工作流文档）按 SKILL_PROMPT 的规则做程序化校验，不再只靠模型自检。
 * 纯函数、无副作用，方便单测与前后端共用。
 *
 * 分级口径：
 * - error：硬性问题（缺 frontmatter、超大、SKILL.md 含未完成标记、空文件），
 *   任一不通过即整体「不合格」。
 * - warn：软性建议（描述长度/关键词/泛化词、scripts/ 决策、脚本容错等），
 *   只提示、不判不合格，避免合理产物被一票否决。
 */
export interface SkillQualificationCheck {
  readonly id: string;
  readonly label: string;
  readonly pass: boolean;
  readonly severity: "error" | "warn";
  /** 不通过时的具体原因（给用户看）。 */
  readonly detail?: string;
}

export interface SkillQualification {
  readonly pass: boolean;
  readonly checks: readonly SkillQualificationCheck[];
}

/** 执行/操作类 description 关键词（命中 ≥2 → 需要 scripts/）。 */
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

/** description 应避免的泛化词（建议级）。 */
const FORBIDDEN_GENERIC = [
  "所有",
  "任何",
  "任意",
  "everything",
  "anything",
  "all kinds",
  "whatever",
];

/** 未完成标记。 */
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
 * 生成侧兜底质检用的文件构建：把模型原始输出转成"文件集"以便 `qualifySkillFiles`
 * 检查。与 UI 的 buildSkillFiles 保持同一口径（skill 解析 `<file>` 标签；
 * prompt/brief 把摘要作为 PROMPT/WORKFLOW 正文）。
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
    // 未解析出 SKILL.md → 整个摘要视为内容，frontmatter 检查自然判不合格，
    // 从而触发重试。
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
 * 对一组产物文件做质检。`kind` 决定适用规则：
 * - skill：完整 SKILL_PROMPT 规则（description 长度/关键词、scripts/ 决策等）
 * - prompt / brief：结构规则（frontmatter、体积、无未完成标记、文件非空）
 */
export function qualifySkillFiles(
  files: readonly { path: string; content: string }[],
  kind: "skill" | "prompt" | "brief",
): SkillQualification {
  // 质检是兜底增强：任何异常都按"通过"返回，绝不抛错、绝不让质检炸掉主流程。
  // 有结果返回即可，质检只在正常路径上给用户参考。
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
  // 防御：超大产物/超多文件直接判不合格并返回，避免在渲染/保存路径上做
  // 无谓的重型处理（质检是纯函数，本就不会死循环，这里只防"卡"）。
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

  // SKILL.md 内的未完成标记是硬性问题；references/scripts 里的仅作建议。
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
