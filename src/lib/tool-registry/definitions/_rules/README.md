# `_rules/` — 内建安全规则指针

架构 v1.5（§6.2）建议内建安全扫描规则存放于
`src/lib/tool-registry/definitions/_rules/security-rules.json`。

**批准 diff（决策记录 D2）**：M6-T3 已完成迁移到
`src/lib/security/security-rules.json`（26 条内建规则 + 构建期安全正则 gate +
`security-rules.generated.ts` 内容 sha256 版本），迁移已生效，不再移动文件。

- 事实源：`src/lib/security/security-rules.json`
- Schema：`src/lib/security/security-rules.schema.ts`
- 生成产物：`src/lib/security/security-rules.generated.ts`
- 生成脚本：`scripts/generate-security-rules.mjs`（prebuild 接入）
- 边界：用户个人安全规则保留为隔离状态，不能覆盖内建规则或任何工具能力
  （审计 P2 / 测试 TC-SEC-001）。
