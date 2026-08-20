import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  FileCode2,
  FolderOpen,
  PackageCheck,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../../../lib/i18n/context";
import { SKILL_AGENTS } from "../../../../lib/local-skills/types";
import type { CandidateOutput } from "../../contracts";
import type { DistillationSessionItem } from "../index.ts";
import { saveCandidateAsSkill } from "../../query";
import { md } from "./markdown";
import { isMemoryKind, kindMeta } from "./out-types.ts";
import { resolveCandidateSource } from "./source-resolve.ts";

function suggestSkillName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "distilled-skill";
}

/** Deduplicated source names of the candidate's selected sessions. */
function sourceNames(candidate: CandidateOutput): string {
  return [...new Set(candidate.selectedSessionRefs.map((ref) => ref.source))]
    .join(" / ")
    .trim();
}

/** 原型 Act 胶囊按钮（rounded-full bg-surface-2）。 */
function Act({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

/** 原型式轻量 Modal（固定层 + 遮罩,渲染在页面树内而非 portal）。 */
function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-md"} animate-fade-in rounded-2xl bg-card p-5`}
      >
        <div className="mb-3 flex items-center">
          <h3 className="text-[13.5px] font-semibold tracking-tight">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface PkgFile {
  readonly path: string;
  readonly content: string;
}

function capabilityLabel(candidate: CandidateOutput, t: ReturnType<typeof useI18n>["t"]): string {
  return t(kindMeta(candidate.kind).labelKey);
}

function packageRootName(candidate: CandidateOutput): string {
  const base = suggestSkillName(candidate.title);
  switch (candidate.kind) {
    case "prompt":
      return `${base}-prompt-pack`;
    case "brief":
      return `${base}-workflow-pack`;
    default:
      return base;
  }
}

/**
 * Generate a complete Skill package (file tree) from the candidate's summary,
 * matching the prototype's `buildFiles` / `buildSkillPackage`: the main
 * knowledge file (SKILL.md / WORKFLOW.md / PROMPT.md) contains the real AI
 * output, while auxiliary files (references, scripts, metadata) are generated
 * from templates — exactly as the prototype does.
 */
function buildSkillFiles(
  summary: string,
  candidate: CandidateOutput,
): PkgFile[] {
  const baseName = packageRootName(candidate);
  if (candidate.kind === "skill") {
    const parsed = [
      ...summary.matchAll(
        /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/giu,
      ),
    ]
      .map((match) => ({ path: match[1]!.trim(), content: match[2]!.trim() }))
      .filter((file) => file.path.length > 0 && file.content.length > 0);
    if (parsed.some((file) => file.path === "SKILL.md")) return parsed;
  }
  const slug = suggestSkillName(candidate.title);
  const sources = sourceNames(candidate);
  const src = sources || "近期素材";
  const sessions = candidate.selectedSessionRefs.length;
  const date = new Date(candidate.generatedAt).toISOString().slice(0, 10);

  if (candidate.kind === "prompt") {
    return [
      {
        path: "SKILL.md",
        content: `---\nname: ${baseName}\ndescription: 由 ${src} 蒸馏得到的可复用 Prompt 能力包\nform: prompt-package\ncreated: ${date}\n---\n\n# ${baseName}\n\n> **类型:** Prompt 能力包\n> **来源:** ${src}\n> **使用方式:** 优先阅读 \`PROMPT.md\`，把其中模板复制到 Agent 系统提示词或工作流节点中。\n\n## 文件说明\n- \`PROMPT.md\`：主提示词模板\n- \`references/usage.md\`：适用方式与接入建议\n`,
      },
      {
        path: "PROMPT.md",
        content: `---\nname: ${slug}\ndescription: 由 ${src} 蒸馏得到的可复用提示词\nform: prompt\ncreated: ${date}\n---\n\n${summary}\n\n## 使用方式\n直接粘贴到Agent的系统提示词或 CLAUDE.md 顶部。\n`,
      },
      {
        path: "references/usage.md",
        content:
          "# 使用建议\n\n1. 先替换变量占位符，再交给 Agent 执行\n2. 如果任务跨度大，建议把 Prompt 拆到多个步骤节点\n3. 若输出不稳定，补充项目上下文与成功标准\n",
      },
    ];
  }

  if (candidate.kind === "brief") {
    return [
      {
        path: "SKILL.md",
        content: `---\nname: ${baseName}\ndescription: 由 ${src} 蒸馏得到的可复用工作流能力包\nform: workflow-package\ncreated: ${date}\n---\n\n# ${baseName}\n\n> **类型:** 工作流能力包\n> **来源:** ${src}\n> **使用方式:** 先阅读 \`WORKFLOW.md\`，按步骤接入到你的 Agent / 自动化编排里。\n\n## 文件说明\n- \`WORKFLOW.md\`：主工作流文档\n- \`references/pitfalls.md\`：已知风险与修复建议\n`,
      },
      {
        path: "WORKFLOW.md",
        content: `---\nname: ${slug}\ndescription: 由 ${src} 蒸馏得到的可复用工作流\nform: workflow\ncreated: ${date}\n---\n\n${summary}\n`,
      },
      {
        path: "references/pitfalls.md",
        content:
          "# 历史踩坑与修复\n\n1. SSR 阶段访问 window：改为 useEffect 内读取\n2. 长列表卡顿：虚拟滚动 + memo\n3. 时区偏差：统一 UTC 存储、本地化展示\n",
      },
    ];
  }

  // kind === "skill" — full pack (default)
  return [
    {
      path: "SKILL.md",
      content: `---\nname: ${slug}\ndescription: 由 ${sessions} 场会话（${src}）蒸馏得到的个人知识 Skill\nlicense: internal\ncreated: ${date}\nallowed-tools: Read, Grep, Glob, Bash(python3 scripts/*)\n---\n\n${summary}\n\n## 参考资料\n- \`references/conventions.md\` 团队与个人编码约定\n- \`references/stack.md\` 技术栈与依赖清单\n- \`references/pitfalls.md\` 历史踩坑与修复方式\n\n## 可执行脚本\n- \`scripts/apply_conventions.py\` 按约定检查/修正当前仓库\n- \`scripts/collect_context.sh\` 采集项目上下文摘要\n`,
    },
    {
      path: "references/conventions.md",
      content: `# 编码约定（蒸馏自 ${sessions} 场会话）\n\n- 组件保持单一职责，超过 200 行拆分\n- 状态优先 URL / query 缓存，避免多份真源\n- 错误处理统一走 toast + 日志，不静默吞异常\n- 命名：函数动词开头，布尔以 is/has 前缀\n`,
    },
    {
      path: "references/stack.md",
      content:
        "# 技术栈画像\n\n| 层 | 选型 | 备注 |\n| --- | --- | --- |\n| 前端 | React 19 + TypeScript | 严格模式 |\n| 路由 | TanStack Router | 文件式路由 |\n| 样式 | Tailwind CSS v4 | 语义 token |\n| 数据 | TanStack Query | 缓存与失效 |\n",
    },
    {
      path: "references/pitfalls.md",
      content:
        "# 常见问题与修复\n\n1. SSR 阶段访问 window：改为 useEffect 内读取\n2. 长列表卡顿：虚拟滚动 + memo\n3. 时区偏差：统一 UTC 存储、本地化展示\n",
    },
    {
      path: "scripts/apply_conventions.py",
      content:
        '#!/usr/bin/env python3\n"""按蒸馏出的约定检查当前仓库。"""\nimport pathlib, re, sys\n\nBAD = re.compile(r"console\\.log\\(")\n\ndef main() -> int:\n    hits = []\n    for f in pathlib.Path("src").rglob("*.ts*"):\n        if BAD.search(f.read_text(encoding="utf-8", errors="ignore")):\n            hits.append(str(f))\n    for h in hits:\n        print("debug log:", h)\n    return 1 if hits else 0\n\nif __name__ == "__main__":\n    sys.exit(main())\n',
    },
    {
      path: "scripts/collect_context.sh",
      content:
        '#!/usr/bin/env bash\nset -euo pipefail\n# 采集项目上下文，供 Skill 在会话开始时读取\necho "## 依赖"; cat package.json | head -40\necho "## 目录"; ls -1 src\n',
    },
    {
      path: "assets/metadata.json",
      content: JSON.stringify(
        {
          slug,
          origin: "local-distill",
          scope: src,
          sessions,
          createdAt: new Date(candidate.generatedAt).toISOString(),
          entry: "SKILL.md",
        },
        null,
        2,
      ),
    },
  ];
}

/** 原型 PkgBrowser：产物包文件树 + markdown 渲染 + 逐文件编辑（原型 146-218）。 */
function PkgBrowser({
  files,
  root,
  color,
  editing,
  onChange,
}: {
  files: PkgFile[];
  root: string;
  color: string;
  editing: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [local, setLocal] = useState<PkgFile[]>(files);
  const [active, setActive] = useState(files[0]?.path ?? "SKILL.md");
  useEffect(() => setLocal(files), [files]);
  const cur = local.find((f) => f.path === active) ?? local[0];
  if (!cur) return null;
  const isMd = cur.path.endsWith(".md");
  return (
    <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl bg-surface-2 p-2">
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[10.5px] text-muted-foreground">
          <FolderOpen className="size-3.5" style={{ color }} />
          {root}/
        </div>
        <ul className="space-y-0.5">
          {local.map((f) => {
            const on = f.path === cur.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setActive(f.path)}
                  className="flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-foreground/[0.05]"
                  style={
                    on
                      ? {
                          background: `color-mix(in oklab, ${color} 16%, transparent)`,
                          color,
                        }
                      : undefined
                  }
                >
                  <FileCode2 className="size-3 shrink-0 opacity-70" />
                  <span className="truncate">{f.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0 overflow-hidden rounded-xl bg-surface-2">
        <div className="flex items-center justify-between px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
          <span className="truncate">
            {root}/{cur.path}
          </span>
          <span>
            {t("distill.fileLines", { count: cur.content.split("\n").length })}
          </span>
        </div>
        {editing ? (
          <textarea
            value={cur.content}
            onChange={(event) => {
              const v = event.target.value;
              setLocal((l) =>
                l.map((f) => (f.path === cur.path ? { ...f, content: v } : f)),
              );
              if (cur.path === files[0]?.path) onChange(v);
            }}
            className="min-h-[260px] w-full resize-y bg-transparent px-3 pb-3 font-mono text-[12px] leading-7 outline-none"
          />
        ) : isMd ? (
          <div
            className="tt-md px-3 pb-3"
            dangerouslySetInnerHTML={{ __html: md(cur.content) }}
          />
        ) : (
          <pre className="tt-scroll max-h-[360px] overflow-auto px-3 pb-3 font-mono text-[11.5px] leading-6 whitespace-pre">
            {cur.content}
          </pre>
        )}
      </div>
    </div>
  );
}

/** 保存弹窗：名称 + 安装目标（等价原型 ToolTargetPicker）+ primary 确认键。 */
function SaveModal({
  candidate,
  draft,
  onClose,
  onSaved,
}: {
  candidate: CandidateOutput;
  draft: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(() => packageRootName(candidate));
  const [targets, setTargets] = useState<string[]>(() => [...SKILL_AGENTS]);
  const [saving, setSaving] = useState(false);
  const kindLabel = capabilityLabel(candidate, t);

  async function handleSave() {
    if (!name.trim() || targets.length === 0) return;
    setSaving(true);
    const savedAgents: string[] = [];
    const failed: string[] = [];
    for (const agent of targets) {
      try {
        const result = await saveCandidateAsSkill({
          data: {
            candidateId: candidate.candidateId,
            skillName: name.trim(),
            targetAgent: agent,
            content: draft,
            files: buildSkillFiles(draft, candidate),
          },
        });
        if (result.ok) {
          savedAgents.push(agent);
        } else {
          failed.push(agent);
        }
      } catch {
        failed.push(agent);
      }
    }
    setSaving(false);
    if (savedAgents.length > 0) {
      toast.success(
        savedAgents.length === 1
          ? `${kindLabel} 已保存到 ${savedAgents[0]}`
          : `${kindLabel} 已保存到 ${savedAgents.length} 个工具`,
      );
    }
    if (failed.length > 0) {
      toast.error(t("distill.savePartialFail", { agents: failed.join(", ") }));
      return;
    }
    onSaved(name.trim());
  }

  return (
    <Modal onClose={onClose} title={`保存并安装${kindLabel}`}>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-[11px] text-muted-foreground">
            {t("distill.saveName")}
          </label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="block text-[11px] text-muted-foreground">
              {t("distill.saveTargets")}
            </label>
            <button
              type="button"
              onClick={() =>
                setTargets((current) =>
                  current.length === SKILL_AGENTS.length
                    ? []
                    : [...SKILL_AGENTS],
                )
              }
              className="rounded-full bg-accent/50 px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent"
            >
              {targets.length === SKILL_AGENTS.length
                ? t("distill.saveClearAll")
                : t("distill.saveSelectAll")}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SKILL_AGENTS.map((agent) => {
              const on = targets.includes(agent);
              return (
                <button
                  key={agent}
                  type="button"
                  onClick={() =>
                    setTargets((current) =>
                      on
                        ? current.filter((item) => item !== agent)
                        : [...current, agent],
                    )
                  }
                  aria-pressed={on}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                    on
                      ? "bg-primary/15 text-foreground"
                      : "bg-accent/25 text-foreground hover:bg-accent/50"
                  }`}
                >
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-md ${
                      on ? "bg-primary text-primary-foreground" : "bg-accent"
                    }`}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{agent}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="mr-auto font-mono text-[10.5px] text-muted-foreground">
            {t("distill.saveTargetsSelected", {
              count: targets.length,
              total: SKILL_AGENTS.length,
            })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-2 px-4 py-2 text-[12px]"
          >
            {t("distill.footerCancel")}
          </button>
          <button
            type="button"
            disabled={saving || !name.trim() || targets.length === 0}
            onClick={handleSave}
            className="rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Save className="mr-1 inline size-3.5" />
            {`保存并安装${kindLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 保存完成引导：告诉用户蒸馏出的 Skill 去哪里找、怎么用（原型 2363-2424）。 */
function SavedGuide({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useI18n();
  const steps: { n: string; t: string; d: string }[] = [
    { n: "1", t: t("distill.savedStep1"), d: t("distill.savedStep1Desc") },
    { n: "2", t: t("distill.savedStep2"), d: t("distill.savedStep2Desc") },
    { n: "3", t: t("distill.savedStep3"), d: t("distill.savedStep3Desc") },
    { n: "4", t: t("distill.savedStep4"), d: t("distill.savedStep4Desc") },
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="tt-overlay absolute inset-0 backdrop-blur-md"
        onClick={onClose}
      />
      <section className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-card p-6 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-2">
          <PackageCheck
            className="size-4"
            style={{ color: "var(--chart-1)" }}
          />
          <h2 className="text-[14px] font-semibold tracking-tight">
            {t("distill.savedGuideTitle", { name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-auto rounded-lg p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <p className="mt-3 text-[13px] leading-relaxed">
          {t("distill.savedGuideDesc")}
        </p>
        <ol className="mt-3 space-y-2">
          {steps.map((x) => (
            <li
              key={x.n}
              className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5"
            >
              <span
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full font-mono text-[10px]"
                style={{
                  background:
                    "color-mix(in oklab, var(--chart-1) 18%, transparent)",
                  color: "var(--chart-1)",
                }}
              >
                {x.n}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px]">{x.t}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {x.d}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex items-center gap-2">
          <Link
            to="/skills"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 font-mono text-[11.5px] text-background transition-opacity hover:opacity-90"
          >
            {t("distill.savedGuideGo")} <ArrowRight className="size-3.5" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-surface-2 px-4 py-2 font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("distill.savedGuideStay")}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * 持久化结果卡,对齐原型 ExpCard(1807-1957):kind 色 mono 头部 + 素材行、
 * 记忆类/能力类两种 body、原型 Act 动作、保存弹窗与 SavedGuide。候选完成即
 * 可用(阶段 A2 自动通过),无 waiting/取消态。运行中进度卡由页面渲染
 * (RunningExpCard),本卡只承载已完成的候选。
 *
 * 已知缺口:原型头部「· Xs · tokens」需要时长/token 遥测,当前执行摘要不记录,
 * 故省略该段;错误态同理(服务端同步运行失败直接 toast,不持久化 error 候选)。
 */
export function ExpCard({
  candidate,
  sessions,
  busy,
  onRegenerate,
}: {
  candidate: CandidateOutput;
  sessions: readonly DistillationSessionItem[];
  busy: boolean;
  onRegenerate: () => void;
}) {
  const { t, format } = useI18n();
  const memoryAsset = isMemoryKind(candidate.kind);
  const badge = kindMeta(candidate.kind);
  const modelLabel = candidate.execution.modelId ?? candidate.mode;
  const kindLabel = t(badge.labelKey);
  // 阶段 A2 后完成即审批,记忆类自动入库 —— saved chip 恒按审批态显示。
  const saved = candidate.approvalState === "approved";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.summary);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedGuideName, setSavedGuideName] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(candidate.summary);
  }, [candidate.summary, editing]);

  const resolved = useMemo(
    () => resolveCandidateSource(candidate, sessions),
    [candidate, sessions],
  );
  const sources = useMemo(
    () => resolved.sources.join(" / ") || sourceNames(candidate),
    [candidate, resolved.sources],
  );
  const projectLine = resolved.projectKeys.join(" / ");
  const titleLine = resolved.sessionTitles.slice(0, 3).join(" · ");
  const files = useMemo<PkgFile[]>(
    () => buildSkillFiles(draft, candidate),
    [draft, candidate],
  );

  return (
    <>
      <article
        className="animate-fade-in relative overflow-hidden rounded-xl bg-card"
        style={{ boxShadow: `inset 3px 0 0 ${badge.color}` }}
      >
        {/* 原型右上角模糊色圈（原型 1828-1831） */}
        <div
          className="pointer-events-none absolute -top-16 right-0 size-40 rounded-full opacity-[0.14] blur-3xl"
          style={{ background: badge.color }}
        />
        <div className="relative flex flex-wrap items-center gap-2 px-4 py-3 font-mono text-[10.5px] text-muted-foreground">
          <span
            className="rounded-full px-2 py-0.5 font-semibold"
            style={{
              background: `color-mix(in oklab, ${badge.color} 16%, transparent)`,
              color: badge.color,
            }}
          >
            {t(badge.labelKey)}
          </span>
          <span>{format.formatDateTime(candidate.generatedAt, false)}</span>
          <span>· {modelLabel}</span>
          {saved && (
            <span
              className="rounded-full px-2 py-0.5"
              style={{
                background:
                  "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                color: "var(--chart-1)",
              }}
            >
              {memoryAsset
                ? t("distill.expSavedMemory")
                : `${kindLabel} 已保存 ✓`}
            </span>
          )}
        </div>
        <div className="relative px-4 pb-2 font-mono text-[10.5px] text-muted-foreground">
          {t("distill.materialMeta", {
            count: candidate.selectedSessionRefs.length,
            sources,
          })}
        </div>
        {(projectLine || titleLine) && (
          <div className="relative space-y-1 px-4 pb-3 font-mono text-[10.5px] text-muted-foreground">
            {projectLine && <div>项目：{projectLine}</div>}
            {titleLine && <div>会话：{titleLine}</div>}
          </div>
        )}

        {memoryAsset ? (
          <>
            <div className="relative px-4 pb-3">
              <div
                className="rounded-xl bg-surface-2 p-3"
                style={{ boxShadow: `inset 3px 0 0 ${badge.color}` }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles
                    className="size-3.5 shrink-0"
                    style={{ color: badge.color }}
                  />
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {candidate.title}
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {t(badge.labelKey)}
                  </span>
                </div>
                {editing ? (
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={8}
                    className="mt-2 min-h-[120px] w-full resize-y bg-transparent text-[12.5px] leading-7 outline-none"
                  />
                ) : (
                  <div
                    className="tt-md mt-2 text-[12.5px] text-foreground/85"
                    dangerouslySetInnerHTML={{ __html: md(draft) }}
                  />
                )}
              </div>
            </div>
            <div className="relative flex flex-wrap items-center gap-2 px-4 pb-4">
              <Act
                icon={Pencil}
                label={
                  editing ? t("distill.expFinishEdit") : t("distill.expEdit")
                }
                onClick={() => setEditing((value) => !value)}
              />
              <Link to="/memory">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: badge.color }}
                >
                  <ArrowRight className="size-3.5" /> {t("distill.memoryGo")}
                </span>
              </Link>
              <Act
                icon={RefreshCw}
                label={t("distill.expRegenerate")}
                onClick={onRegenerate}
                disabled={busy}
              />
            </div>
          </>
        ) : (
          <>
            <div className="relative px-4 pb-3">
              <PkgBrowser
                files={files}
                root={packageRootName(candidate)}
                color={badge.color}
                editing={editing}
                onChange={setDraft}
              />
            </div>
            <div className="relative flex flex-wrap items-center gap-2 px-4 pb-4">
              <Act
                icon={Pencil}
                label={
                  editing ? t("distill.expFinishEdit") : t("distill.expEdit")
                }
                onClick={() => setEditing((value) => !value)}
              />
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: badge.color }}
              >
                <Rocket className="size-3.5" /> {`保存并安装${kindLabel}`}
              </button>
              <Act
                icon={RefreshCw}
                label={t("distill.expRegenerate")}
                onClick={onRegenerate}
                disabled={busy}
              />
            </div>
          </>
        )}
      </article>

      {saveOpen && (
        <SaveModal
          candidate={candidate}
          draft={draft}
          onClose={() => setSaveOpen(false)}
          onSaved={(name) => {
            setSaveOpen(false);
            setSavedGuideName(name);
          }}
        />
      )}
      {savedGuideName && (
        <SavedGuide
          name={savedGuideName}
          onClose={() => setSavedGuideName(null)}
        />
      )}
    </>
  );
}

/** 并排对比弹窗（原型 CompareModal 2034-2049）：Modal wide + markdown 渲染。 */
export function CandidateCompareDialog({
  candidates,
  onClose,
}: {
  candidates: readonly [CandidateOutput, CandidateOutput];
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  return (
    <Modal onClose={onClose} title={t("distill.compare")} wide>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {candidates.map((candidate, index) => (
          <div
            key={`${candidate.candidateId}-${index}`}
            className="tt-scroll max-h-[60vh] overflow-y-auto rounded-xl bg-surface-2 p-3"
          >
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {t(kindMeta(candidate.kind).labelKey)} ·{" "}
              {candidate.execution.modelId ?? candidate.mode} ·{" "}
              {format.formatDateTime(candidate.generatedAt, false)}
            </div>
            <div
              className="tt-md mt-2"
              dangerouslySetInnerHTML={{ __html: md(candidate.summary) }}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
