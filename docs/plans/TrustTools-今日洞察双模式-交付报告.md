# TrustTools 今日洞察双模式 — 交付报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 交付报告 (DELIVERY-REPORT) |
| 项目名称 | TrustTools-今日洞察双模式 |
| 报告日期 | 2026-08-20 |
| 分支 | `feature/llm` |
| 状态 | 完成（含收尾补齐；见「遗留风险」） |
| 收尾整合 | 集成子代理（等待 → 验证 → 补齐 → 全绿 → 对照回顾 → 报告） |

---

## 1. 模块清单与负责人

5 个并行开发代理 + 收尾整合代理。各模块已由主代理分次提交（`git log`）：

| 模块 | 提交 | 内容 | 落盘状态 |
|------|------|------|----------|
| M1 Insight Core（规则核心） | `16060ad feat(insights): 实现今日洞察双模式 Insight Core 规则核心` | `insights/page/`（contracts、domain、application、action/rule registry） | ✅ 已提交 |
| M2 Insight Enhancer（LLM 增强器） | `1d69ae9 feat(insights): 可选 LLM 增强器 Insight Enhancer` | `insights/enhancer/`（application、validation、prompt-registry、llm generator） | ✅ 已提交 |
| M3 证据适配器 + 组合根 + server fns | `50f2322 feat(insights): 14 页证据适配器 + 组合根接线 + server fns` | `app/insight-registry.server.ts`、`app/insights/`、14 个 `insight-evidence.server.ts`、`insights/page/server-fns.ts` | ✅ 已提交 |
| M4 安全 LLM 检测 | `b74f97f feat(security): 安全与防御可选 LLM 检测` | `security-assessment/application/llm-review.server.ts`、`llm-review.contracts.ts`、`llm-review.server-fns.ts`、`use-security-llm-review.ts` | ✅ 已提交 |
| M5 前端接线 | `1398a92 feat(insights): 今日洞察双模式前端接线` | `use-page-insight.ts`、`insight-card.tsx`、`InsightSettingsSection.tsx`、14 路由接线、JarvisInsight 扩展 | ✅ 已提交 |
| 收尾整合 | 未提交（待主代理统一提交） | 见 §4「补齐的遗漏项」 | ⏳ 9 个文件待提交 |

---

## 2. 逐模块文件清单

### 2.1 M1 — `src/modules/insights/page/`
- `contracts.ts` — `INSIGHT_SURFACE_IDS`（14 个）、`InsightScope/Evidence/EvidenceBundle`、`InsightSeverity`、`InsightActionId`、`InsightCandidate/EnvelopeLine/Envelope`、`PageInsightAdapter`、`InsightEnhancementInput/Result/EnhancerPort`、`InsightMode/Preference/StorePort`。
- `application.ts` — `createPageInsightsApplication`（`read` / `enhance`）。
- `domain.ts` — `composeRulesEnvelope`、`filterValidCandidates`、`rankCandidates`、`resolveFactText`、`canonicalScopeHash`、`evidenceHash`、`validateEvidenceBundle/Candidates`。
- `action-registry.ts` — 10 个动作 → 站内路径 + 标签 key。
- `rule-ids.ts` / `rule-registry.ts` — 每 surface 的规则事实 id 与行数预算（widget=1，其余=3）。
- `index.ts`、`server-fns.ts` — `getPageInsight`（GET）、`enhancePageInsight`（POST）、`setInsightPreferences`（POST）。
- `presentation/` — `use-page-insight.ts`、`use-page-insight.pure.ts`、`insight-card.tsx`、`InsightSettingsSection.tsx`、`use-page-insight.test.ts`。

### 2.2 M2 — `src/modules/insights/enhancer/`
- `contracts.ts`、`application.ts`（`createInsightEnhancer`，默认日预算 30、singleflight、缓存、kill-switch 无关）、`validation.ts`（五层校验 + `assertPayloadSafe`、16KiB）、`prompt-registry.ts`（14 surface prompt，版本化）、`llm-page-insight-generator.ts`（`providerId:"profile"`、15s 超时）、`index.ts`。

### 2.3 M3 — 组合根与证据适配器
- `src/app/insight-registry.server.ts` — `createInsightAdapterRegistry()`（14 适配器）、`createPageInsightsApplicationForRoot()`（kill-switch 门 + enhancer 构造）、`getPageInsightsApplication()`。
- `src/app/insights/evidence-util.server.ts` — 证据构造/校验/取值辅助（只允许标量）。
- 14 个 `insight-evidence.server.ts`（surface → 文件）：
  - dashboard/widget → `modules/dashboard/insight-evidence.server.ts`
  - agents/tracker → `modules/usage/insight-evidence.server.ts`
  - distill → `modules/distillation/insight-evidence.server.ts`
  - reports → `modules/reports/insight-evidence.server.ts`
  - memory → `modules/knowledge/insight-evidence.server.ts`
  - security → `modules/security-assessment/insight-evidence.server.ts`
  - skills → `modules/skill-catalog/insight-evidence.server.ts`
  - chats/chat-detail → `modules/sessions/insight-evidence.server.ts`
  - sources → `modules/sources/insight-evidence.server.ts`
  - market → `lib/local-market/insight-evidence.server.ts`
  - settings → `modules/settings/insight-evidence.server.ts`
- 组合根 `src/app/composition.server.ts` 新增 `readonly insights: PageInsightsApplication`。

### 2.4 M4 — `src/modules/security-assessment/`
- `application/llm-review.server.ts` — `createSecurityLlmReviewService`（白名单聚合、五层校验、只读补充、TTL+singleflight、`providerId:"profile"`）。
- `llm-review.contracts.ts` — `SECURITY_LLM_DIMENSIONS`（11 维）、`buildSecurityLlmReviewAggregate`。
- `llm-review.server-fns.ts` — `getSecurityLlmReview`（POST）、`getSecurityLlmReviewAvailability`、`setSecurityLlmReviewEnabled`。
- `presentation/use-security-llm-review.ts` + `SkillReportModal.tsx` 接线；`security.ts` i18n 含「AI 辅助分析 / 仅补充，不改变判定」。

### 2.5 M5 — 前端接线
- `src/components/JarvisInsight.tsx`（扩展 `actions`/`pills`/`icon`，向后兼容）。
- 14 surface UI 接线：`InsightCard`/`usePageInsight` 接入 dashboard、agents（ToolOverview）、distill、reports、memory、security、tracker、skills、market、chats、chat-detail、widget、sources；settings 用 `InsightSettingsSection`。
- i18n：`locales/*/insights.ts` 全量 `actions.*` + `page.*`（14 surface）；`settings.ts` insight 段；`security.ts` llmReview 段。

---

## 3. 需求对照表（满足 / 部分 / 缺失）

### 3.1 原始需求（PRD FR-DM / NFR-DM，取自《今日洞察双模式敏捷任务清单》）

| ID | 需求 | 状态 | 证据 |
|----|------|------|------|
| FR-DM-001 | 14 UI 路由统一今日洞察 | ✅ 满足 | 14 个 adapter 全注册；`insight-registry.test.ts`「registry covers all 14 surfaces」通过 |
| FR-DM-002 | 洞察不依赖大模型 | ✅ 满足 | `read()` 纯规则路径不触碰 enhancer/Profile；测试「read returns a complete rules envelope」通过 |
| FR-DM-003 | 事实与动作由本地代码控制 | ✅ 满足 | 证据只允许标量；`metricValue` 是唯一取数入口；数字从 evidence 复制 |
| FR-DM-004 | 用户主动启用 LLM 增强（manual） | ✅ 满足 | `enhancePageInsight` POST + `enhanced-manual` 偏好 |
| FR-DM-005 | 自动增强 opt-in（auto） | ✅ 满足 | `enhanced-auto` + 显式 consent（`InsightSettingsSection` 勾选，未勾选禁存） |
| FR-DM-006 | 本地优先与数据最小化 | ✅ 满足 | 规则模式零外发；`assertPayloadSafe` ≤16KiB 且拒路径/命令/凭据/实体名 |
| FR-DM-007 | 安全洞察不可被模型弱化 | ✅ 满足 | 五层校验 L3「mandatory 不遗漏」+ L4「severity/动作白名单」；security risk 候选 `mandatory:true` |
| NFR-DM-001 | 规则洞察不阻塞首屏 | ✅ 满足 | 纯规则计算，无网络；P95 未做性能实测（见遗留风险） |
| NFR-DM-002 | zh-CN/en-US/ja-JP | ✅ 满足（超出：ko-KR） | 四语言字典完整；`check:i18n` translations/locale-sync 通过 |
| NFR-DM-003 | 增强成本/故障可控 | ✅ 满足 | 缓存（SQLite）、日预算 30、15s 超时、singleflight、kill switch |

### 3.2 目标规格核心验收行为（任务书 2.2 #1–11）

| # | 验收行为 | 状态 | 证据 |
|---|---------|------|------|
| 1 | 未配置大模型 = 默认 rules 且完整；GET 不读模型/不发网络 | ✅ | `getPageInsight` handler 仅 `application.read()`；无 Profile→enhancer 不构造 |
| 2 | 配置后 LLM 增强：`providerId:"profile"` + 激活 profile、15s 超时、五层校验、失败保留规则结果 | ✅ | `llm-page-insight-generator.ts`（15_000ms、profile）、`validation.ts`（L1–L5）、`application.test.ts`「enhance failure keeps rules lines identical」 |
| 3 | 安全 LLM 检测：只读补充、白名单聚合、不弱化 verdict、默认关闭、UI 标注 | ✅ | M4 全套 + `security.ts`「仅补充，不改变判定」+ `SECURITY_LLM_REVIEW_PREF_KEY` 默认关 |
| 4 | 缓存/预算：`insight_enhancement_cache/lines`、写前 `assertInsightLineAnalysisSafe`、缓存键=surface+scopeHash+evidenceHash+locale+profileId+promptVersion、singleflight、日 30、rules 不写表 | ✅ | `enhancer/application.ts`（identity 六元组、`DEFAULT_DAILY_CALL_LIMIT=30`、`saveEnhancement` mode 守卫）、`sqlite-insight-repository.server.ts` 已有且写前调 privacy guard |
| 5 | 偏好：默认 rules、global/surface 两级、三态、profileId 必须存在、dailyCallLimit；settings 模式选择 + consent + 中性提示 | ✅ | `setInsightPreferences`（`listViews` 校验 profileId）、`InsightSettingsSection`、`settings.ts` i18n |
| 6 | kill switch：`insight.killSwitch` 时不构造 enhancer、不读 Profile | ✅（键名适配） | `insight-registry.server.ts` 读 `insight.killswitch`（小写，因 `RuntimeFlagRepository` 的 `SAFE_KEY=/^[a-z]…/` 拒绝大写 S）；见遗留风险 R1 |
| 7 | i18n 四语言完整（zh 为事实源）、三段式、诚实空态、安全高危第一条 mandatory+risk | ✅（mandatory 由收尾补齐） | `insights.ts` 四语言 `actions.*`+`page.*`；空态一律诚实；security risk 候选 `mandatory:true`（收尾补齐） |
| 8 | 范围控制：蒸馏/日报/记忆不做 LLM 生成 | ✅ | 三者 evidence adapter 仅读计数/状态，无 `aiExecutor` 依赖 |
| 9 | 隐私：payload ≤16KiB 只含脱敏事实/severity/actionId；DTO 不含 prompt/key/endpoint/cache/cost | ✅ | `assertPayloadSafe` + `InsightEnvelope`/`InsightPreferenceView` 白名单投影 |
| 10 | 既有测试不回归；旧 facade 兼容 | ✅ | `test:unit` 1354 全绿；旧 `src/lib/page-insights` 未删，`tsc` 0 错 |
| 11 | 14 页 UI 接线；JarvisInsight 向后兼容；enhance 按钮仅 canEnhance + 60s 冷却 | ✅ | 14 surface 全部 `InsightCard`/`usePageInsight`；`use-page-insight.pure.ts` `canEnhanceNow`/`ENHANCE_COOLDOWN_MS` |

### 3.3 契约（任务书 2.1）核对

`src/modules/insights/page/contracts.ts` 导出名与 2.1 规格一致（`INSIGHT_SURFACE_IDS`、`InsightSurfaceId`、`InsightScope`、`InsightEvidence`、`InsightEvidenceBundle`、`InsightSeverity`、`InsightActionId`、`InsightCandidate`、`InsightEnvelopeLine`、`InsightEnvelopeStatus`、`InsightEnvelope`、`PageInsightAdapter`、`InsightEnhancementInput`、`InsightEnhancementStatus`、`InsightEnhancementResult`、`InsightEnhancerPort`、`InsightMode`、`InsightPreference`、`InsightStorePort`）。

两点实现级偏差（非缺陷，已核对可接受）：
- `factKey/ruleKey/key/labelKey` 类型用 `MessageKey`（`Paths<typeof zh>`，即 `insights.*` 的超集模板字面量）替代 `` `insights.${string}` ``，与全仓库类型化 i18n 一致，且 `MessageKey` 由 zh 字典派生，天然包含 `insights.page.*`/`insights.actions.*`。
- `createPageInsightsApplication` / `PageInsightsApplication` 落在 `application.ts`（`contracts.ts` 保留纯类型/常量），registry 从 `application.ts` 导入，`index.ts` 统一再导出。

---

## 4. 补齐的遗漏项（收尾整合代理）

等待阶段检测到主代理已提交 M1–M5 后，收尾代理核对并修复了以下遗漏（9 个文件，**未提交**，待主代理统一提交）：

| # | 遗漏/缺陷 | 修复文件 | 说明 |
|---|----------|---------|------|
| F1 | `scripts/check-hardcoded-text.mjs` 用 Unix `find -name "*.tsx"`，Windows 下 Git Bash find 因 MSYS 参数转换崩溃，导致 `check:i18n` 在扫描前即失败 | `scripts/check-hardcoded-text.mjs` | 改为 Node 原生 `readdirSync(recursive)` 跨平台枚举 |
| F2 | `check-hardcoded-text` 暴露 4 处既有硬编码 CJK（此前被 F1 掩盖） | `src/components/ChunkErrorBoundary.tsx`、`src/components/tt.tsx`、4× `locales/*/common.ts` | 「内容加载失败/重试/上一页/下一页」迁移到 i18n（新增 `common.chunkLoadFailed`、`common.pagination.previous/next`） |
| F3 | `insights/enhancer/prompt-registry.ts` 硬编码品牌名「TrustTools」（M2 引入，违反 `check-app-config-sync` 品牌门） | `src/modules/insights/enhancer/prompt-registry.ts` | 改用 `APP_NAME`（`lib/app-config.ts`），与 M4 的 `llm-review.server.ts` 一致 |
| F4 | 安全页高危候选缺 `mandatory:true`（违反 2.2 #7「mandatory + severity=risk」） | `src/modules/security-assessment/insight-evidence.server.ts` | security risk-top 候选补 `mandatory:true`，保证排序第一且增强校验不遗漏 |

---

## 5. 测试与门禁结果

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | ✅ 0 错误（exit 0） |
| 单元测试 | `npm run test:unit` | ✅ 1354 tests / 1350 pass / 0 fail / 4 skipped（复跑两次一致） |
| 脚本测试 | `npm run test:scripts` | ✅ 30 pass / 0 fail（browser-server 边界、模块边界、sqlite-only、opensource 卫生） |
| i18n（翻译部分） | `npm run check:i18n` 前五步 | ✅ tsc + 44 i18n tests + check-translations（2267 keys）+ check-hardcoded-text + check-locale-sync 全过 |
| i18n（品牌门） | `check-app-config-sync` | ⚠️ 62 处既有「hardcoded brand literal」+ 2 处 env 字面量（见 R2） |
| Lint | `npx eslint`（全部改动文件） | ✅ 0 error / 0 warning |
| 数据库测试 | `npm run test:database` | ✅ 138 tests / 137 pass / 0 fail / 1 skipped（含 insight 表约束、privacy 守卫、analysis CHECK） |

> 注：`npm run check:i18n` 的完整链路因最后一环 `check-app-config-sync` 有 62 处**既有**品牌字面量（非本轮洞察功能引入）而整体返回非零。i18n 相关全部子步骤已绿，品牌门为独立的、未完成的 rebrand 收尾（见 R2）。

---

## 6. 遗留风险

- **R1 — kill switch 键名与规格不一致（可接受）**：规格要求 `insight.killSwitch`（camelCase），实现用 `insight.killswitch`（全小写）。原因：`RuntimeFlagRepository` 的 `SAFE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/` 拒绝大写字符，`insight.killSwitch` 会被 `checkKey` 直接抛错。`insight-registry.server.ts` 已注释说明。功能等价（flag 为 true 时不构造 enhancer、不读 Profile），但若上层以 `insight.killSwitch` 精确字符串写入会失效——建议在规格/运维文档中统一为 `insight.killswitch`。
- **R2 — `check-app-config-sync` 62 处既有品牌字面量（越界，非本轮引入）**：分布在 `src/platform/database/*`（migration-runner、backup、database-host、contracts、migrations/*）、`src/app/database-runtime.server.ts`、`desktop-state-broker.server.ts`、`skill-distribution/MarketPanel.tsx`、`locales/*/skills.ts`、`knowledge/query.test.ts`、`local-usage/dsh.server.test.ts`、`scripts/verify-sqlite-only.mjs(+.test.mjs)` 等。这些是「rebrand 验收门」未收尾的既有技术债，与今日洞察功能无关；本轮已把**唯一由洞察功能引入**的 `prompt-registry.ts` 修复，其余 62 处建议单独立项由 rebrand 专项收尾（勿在本次功能提交中顺带改动数据库 HMAC/application_id 等需保持稳定的功能字面量）。
- **R3 — 无模型首屏 P95 未实测**：NFR-DM-001 的性能目标（P95 < 50ms）本轮未跑 benchmark；纯规则路径无网络、证据适配器均走 O(1) 读模型，逻辑上满足，但缺少量化数据。
- **R4 — ja-JP / ko-KR 为 AI 翻译稿**：`check-translations` 提示「2/2 个语言包标注待审校」，发布前需人工审校并清除标记（不影响门禁通过，属既有状态）。
- **R5 — 增强路径无真实模型 E2E**：enhance/llm-review 的五层校验、缓存、预算均由 fake provider / 单测覆盖；真实模型调用未在 CI 门禁内（符合「真实模型不作为普通 CI 门」的规划）。

---

## 7. 结论

- 今日洞察双模式（14 页规则核心 + 可选 LLM 增强 + 安全 LLM 检测）**实现完整**，主代理已分次提交 M1–M5。
- 收尾整合代理完成等待→验证→补齐闭环：`tsc`、`test:unit`、`test:scripts`、`test:database`、`eslint`（改动文件）全部通过；`check:i18n` 的 i18n 子步骤全绿。
- 收尾代理新增 9 个文件修改（F1–F4，未提交），需主代理统一 `git commit`（收尾代理未执行任何 commit/push）。
- 唯一未全绿的完整链路是 `check-app-config-sync` 的 62 处既有品牌字面量（rebrand 未收尾，越界），以及规格键名 `insight.killSwitch`→实现的 `insight.killswitch` 适配，两者均已在此报告标注，不影响本次功能交付验收。
