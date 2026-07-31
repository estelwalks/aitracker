# TrustTools V3.0 代码相似度检查报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 测试审计报告 (TEST-AUDIT) |
| 项目名称 | TrustTools V3.0 |
| 版本 | v1.0 |
| 创建日期 | 2026-07-28 12:02:22 |
| 更新日期 | 2026-07-28 12:02:22 |
| 生成工具 | test-audit |
| 文档状态 | 评审中 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.0 | 2026-07-28 12:02:22 | 首次对 TrustTools 与 TokenTracker 业务源码执行跨项目重复片段检查 |

---

## 1. 检查目标

验证 TrustTools 仅借鉴本地数据获取思路，没有复制 TokenTracker 的实现代码，为 NFR-005 Clean Room 合规提供可重复的技术证据。

## 2. 检查范围

| 项目 | 路径或版本 |
|------|------------|
| TrustTools | `/Users/liyanjun/ks_project/trusttools_webapp/src` |
| TokenTracker 核心 | `/Users/liyanjun/ks_project/TokenTracker/src` |
| TokenTracker Dashboard | `/Users/liyanjun/ks_project/TokenTracker/dashboard/src` |
| TokenTracker 固定版本 | `32df4feba1f8833265af0f70867e8107af592171` |
| 检查工具 | `jscpd 4.0.5` |

排除项：

- 测试文件 `**/*.test.ts`
- Fixture `**/__fixtures__/**`
- 自动生成路由 `**/routeTree.gen.ts`
- 通用 UI 组件 `**/components/ui/**`
- `node_modules`、构建产物和其他生成目录

## 3. 检查参数

```text
formats: typescript, javascript, tsx, jsx
minimum lines: 5
minimum tokens: 50
reporters: json, console
```

本次共分析 539 个文件、86,700 行、814,160 个 Token。

## 4. 结果

| 指标 | 结果 |
|------|-----:|
| 全部扫描输入中的重复片段 | 142 |
| 全部扫描输入的重复行占比 | 2.44% |
| 全部扫描输入的重复 Token 占比 | 2.69% |
| TrustTools 与 TokenTracker 的跨项目重复片段 | **0** |
| TrustTools 与 TokenTracker 的跨项目重复行 | **0** |
| 跨项目可检测重复率 | **0%** |

142 个重复片段全部发生在各自项目内部，没有任何一个重复片段的一端位于 TrustTools、另一端位于 TokenTracker。

## 5. 结论

在“连续至少 5 行且至少 50 Token”的检测阈值下，TrustTools 与固定版本 TokenTracker 的跨项目可检测重复率为 **0%**，满足 PRD 要求的 `<10%` 技术门禁。

该结果证明当前扫描范围内没有达到阈值的直接重复实现，但不能替代许可证审查和人工 Clean Room 复核。发布前仍需结合 `CLEAN_ROOM.md`、`NOTICE`、依赖许可证清单和人工抽查共同签核。

## 6. 复现方式

```bash
npx --yes jscpd@4.0.5 \
  /Users/liyanjun/ks_project/trusttools_webapp/src \
  /Users/liyanjun/ks_project/TokenTracker/src \
  /Users/liyanjun/ks_project/TokenTracker/dashboard/src \
  --format "typescript,javascript,tsx,jsx" \
  --min-lines 5 \
  --min-tokens 50 \
  --reporters "json,console" \
  --ignore "**/*.test.ts,**/__fixtures__/**,**/routeTree.gen.ts,**/components/ui/**"
```
