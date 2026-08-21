import assert from "node:assert/strict";
import test from "node:test";

import { countExecutionKeywords, qualifySkillFiles } from "./qualify.ts";

const skillMd = (description: string) =>
  [
    "---",
    `name: Test_Skill`,
    `description: ${description}`,
    "---",
    "",
    "# Test Skill",
    "",
    "使用说明与核心运行指令。",
  ].join("\n");

test("qualifySkillFiles: 执行类 skill 结构完整时判定合格", () => {
  const desc =
    "自动化脚本工具，用于运行部署扫描并生成报告，可执行创建和上传操作，输出 Markdown 交付物，帮助用户一键完成重复性运维任务。";
  const files = [
    { path: "SKILL.md", content: skillMd(desc) },
    {
      path: "scripts/run.py",
      content:
        "def main():\n    try:\n        run()\n    except Exception as e:\n        print(e)\n",
    },
  ];
  const result = qualifySkillFiles(files, "skill");
  assert.equal(result.pass, true, JSON.stringify(result.checks));
  assert.ok(result.checks.every((check) => check.pass));
});

test("qualifySkillFiles: 软性问题（缺 scripts/、描述偏短、泛化词）只提示不判不合格", () => {
  // 缺 scripts/（warn）
  const noScripts = qualifySkillFiles(
    [
      {
        path: "SKILL.md",
        content: skillMd(
          "自动化脚本工具，用于运行部署扫描并生成报告，可执行创建和上传操作，输出 Markdown 交付物。",
        ),
      },
    ],
    "skill",
  );
  assert.equal(noScripts.pass, true);
  assert.equal(
    noScripts.checks.find((c) => c.id === "scripts-decision")?.severity,
    "warn",
  );

  // 描述过短 + 泛化词（warn）
  const soft = qualifySkillFiles(
    [{ path: "SKILL.md", content: skillMd("很短的描述，包含所有任何任意") }],
    "skill",
  );
  assert.equal(soft.pass, true);
  assert.equal(
    soft.checks.find((c) => c.id === "desc-length")?.severity,
    "warn",
  );
  assert.equal(
    soft.checks.find((c) => c.id === "desc-generic")?.severity,
    "warn",
  );

  // 知识类误建 scripts/（warn）
  const knowledgeWithScripts = qualifySkillFiles(
    [
      {
        path: "SKILL.md",
        content: skillMd(
          "提供编写高质量文档的指导与建议，辅助用户产出内容，帮助整理结构。",
        ),
      },
      { path: "scripts/run.py", content: "print('x')" },
    ],
    "skill",
  );
  assert.equal(knowledgeWithScripts.pass, true);
  assert.equal(
    knowledgeWithScripts.checks.find((c) => c.id === "scripts-decision")
      ?.severity,
    "warn",
  );
});

test("qualifySkillFiles: SKILL.md 内 TODO/FIXME 判不合格", () => {
  const desc =
    "自动化脚本工具，用于运行部署扫描并生成报告，可执行创建和上传操作，输出 Markdown 交付物。";
  const files = [
    {
      path: "SKILL.md",
      content: skillMd(desc) + "\nTODO: 待补充示例\nFIXME: 修正",
    },
    {
      path: "scripts/run.py",
      content:
        "def main():\n    try:\n        pass\n    except Exception:\n        pass\n",
    },
  ];
  const result = qualifySkillFiles(files, "skill");
  assert.equal(result.pass, false);
  assert.equal(
    result.checks.find((c) => c.id === "no-todo")?.severity,
    "error",
  );
  // references 里的 TODO 只是建议，不判不合格
  const refTodo = qualifySkillFiles(
    [
      { path: "SKILL.md", content: skillMd(desc) },
      { path: "references/guide.md", content: "TODO 示例" },
    ],
    "skill",
  );
  assert.equal(refTodo.pass, true);
});

test("qualifySkillFiles: 缺 frontmatter / 空文件 / 超大判不合格", () => {
  const noFrontmatter = qualifySkillFiles(
    [{ path: "SKILL.md", content: "# 没有 frontmatter\n" }],
    "skill",
  );
  assert.equal(noFrontmatter.pass, false);
  assert.equal(
    noFrontmatter.checks.find((c) => c.id === "frontmatter")?.severity,
    "error",
  );

  const emptyFile = qualifySkillFiles(
    [
      {
        path: "SKILL.md",
        content: skillMd(
          "这是一个合理的描述文本，长度足够长且包含中英文关键词。",
        ),
      },
      { path: "scripts/x.py", content: "" },
    ],
    "skill",
  );
  assert.equal(emptyFile.pass, false);
  assert.equal(
    emptyFile.checks.find((c) => c.id === "files-nonempty")?.severity,
    "error",
  );
});

test("qualifySkillFiles: prompt/brief 只做结构校验", () => {
  const promptFiles = [
    {
      path: "SKILL.md",
      content: "---\nname: P\ndescription: 提示词模板\n---\n# P\n",
    },
    { path: "PROMPT.md", content: "# 模板\n" },
  ];
  const result = qualifySkillFiles(promptFiles, "prompt");
  assert.equal(result.pass, true, JSON.stringify(result.checks));
  assert.equal(qualifySkillFiles(promptFiles, "brief").pass, true);
});

test("countExecutionKeywords 命中数量", () => {
  assert.equal(countExecutionKeywords("自动化 脚本 生成 创建"), 4);
  assert.equal(countExecutionKeywords("提供指导与建议，辅助产出内容"), 0);
});
