# TrustTools 页面性能优化 — 数据迁移清单（T7-05）

| 属性 | 值 |
|------|-----|
| 文档类型 | 数据迁移清单 (DATA-MIGRATION) |
| 关联 | TrustTools-页面性能优化-敏捷任务清单.md T7-05、ADR-009 |

## 迁移原则

1. **永不原地修改旧文件**：新快照写入独立 sibling 文件；旧文件只读兼容。
2. **copy-forward 只发生一次**：新文件不存在时从旧文件复制，之后只读新文件。
3. **迁移失败统一行为**：停止写入、保留原文件、返回 last-known-good/空态、记录稳定错误码。
4. **幂等**：重复执行迁移无副作用；preflight 在每次写入前校验空间/权限/schema/锁。

## 迁移映射表

| 旧数据 | 新位置 | 迁移策略 | 回滚策略 |
|--------|--------|----------|----------|
| `~/.trusttools/tasks/usage-snapshot.v1.json` | `~/.trusttools/tasks/usage-snapshot-envelope.v1.json` | 首次无新文件时 copy-forward（`envelopeFromLegacy`，标记 `migrated-from-legacy`） | 旧版本继续读旧文件；新文件可被忽略 |
| `~/.trusttools/tasks/preferences.v1.json` | 不变（同文件） | 任务 ID 保持稳定（usage.refresh 等）；越界值回到配置默认并记录非敏感诊断 | repository schema 兼容旧版本；不删除旧字段 |
| `~/.trusttools/tasks/runs.v1.json` | 不变 | 无迁移；恢复 running 记录 | 无 |
| （新增）`session-snapshot-envelope.v1.json` | 新增版本化文件 | 只提交完整态；损坏回退空 envelope | 删除读取开关即可回 legacy；无反向迁移 |
| （新增）`skill-snapshot-envelope.v1.json` | 同上 | 同上 | 同上 |
| （新增）`installation-snapshot-envelope.v1.json` | 同上 | 同上 | 同上 |
| （新增）`wsl-topology-snapshot-envelope.v1.json` | 同上 | 同上 | 同上 |
| （新增）`project-classification-index.v1.json` | 新增索引文件 | 增量分类；指纹/mtime 复用 | 删除索引即回退到每次分类 |
| `~/.trusttools/cache/usd-rates.json` | 不变（同文件） | 兼容读取旧 cache；下次成功后台刷新后写新值 | stale/旧 cache/内建汇率逐级降级 |
| `performance-rollout.v1.json` | 新增状态文件 | 独立于策略源；非法/损坏值安全回到 `legacy` | 紧急开关 `TRUSTTOOLS_FORCE_LEGACY_READ_PATH` 优先 |
| 原始 AI 工具日志 | 永不迁移 | 仅由受控 collector 只读 | 不适用 |

## Preflight 检查（每次写入前）

| 检查 | 失败行为 |
|------|----------|
| 目录可写/空间充足 | 停止写入，保留原文件，记录 `io-failure` |
| 文件权限（0600） | 停止写入，记录 `access-denied` |
| schema 版本兼容 | 停止写入，记录 `migration-failed` |
| 文件锁可获取 | 等待/放弃，记录 `lock-conflict`（`target-busy`） |

## 执行入口

- Usage envelope：`createUsageEnvelopeRepository`（`src/modules/usage/infrastructure/usage-envelope.server.ts`）
- 通用 envelope：`createSnapshotEnvelopeRepository`（`src/platform/snapshot-runtime/envelope-repository.ts`）
- 分类索引：`createClassificationIndexRepository`（`src/modules/dashboard/classification-index.server.ts`）
- 汇率：`createExchangeRateRepository`（`src/platform/snapshot-runtime/exchange-rate.server.ts`）

## 验证命令

```bash
node --import tsx --test src/modules/usage/infrastructure/usage-envelope.server.test.ts
node --import tsx --test src/platform/snapshot-runtime/coordinator.test.ts
node --import tsx --test src/modules/dashboard/classification-index.test.ts
```
