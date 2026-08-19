# TrustTools 页面性能优化 — 回滚手册与演练记录（T7-07）

| 属性 | 值 |
|------|-----|
| 文档类型 | 运维手册 (OPS-RUNBOOK) |
| 关联 | TrustTools-页面性能优化-敏捷任务清单.md T7-07、§14.2 |

## 1. 回滚步骤（用户可见行为异常时）

> **T7-08 后的状态（2026-08-18）：** legacy 读取路径（30 秒缓存、页面直连 scanner 的旧 server-fn）已删除，`defaultStage` 已推进 `new-default`。`TRUSTTOOLS_FORCE_LEGACY_READ_PATH` kill switch 与 `performance-rollout.v1.json` 保留为紧急开关机制，但已无 legacy 代码可回退——**回滚方式变为恢复上一个发布版本安装包**（旧数据文件保持只读兼容，copy-forward 迁移保留）。

```text
1. 若为当前版本内故障：先尝试 kill switch（TRUSTTOOLS_FORCE_LEGACY_READ_PATH=1
   或 performance-rollout.v1.json 的 forceLegacyReadPath=true），重启本地应用；
   该开关保留用于隔离"新链路异常"与"环境问题"（T7-08 后无 legacy 读取路径，
   开关主要起隔离作用）。
2. 停止新 scheduler 对目标领域的触发（设置页任务开关），避免 collector 并发。
3. 保留新快照和诊断用于定位，不删除原始日志或旧快照。
4. 若是新 schema/写入故障，恢复上一个发布版本安装包并执行 downgrade smoke：
   旧版本读取旧文件（usage-snapshot.v1.json 等）不受影响。
5. 修复后从 shadow 重新开始，不直接跳到失败前阶段。
```

紧急开关优先级：`TRUSTTOOLS_FORCE_LEGACY_READ_PATH`（env）> 本机 rollout state > 策略默认阶段。相关实现见 `src/app/performance-rollout.ts`。

## 2. 演练清单（每个版本发布前执行）

| 演练 | 方法 | 通过标准 |
|------|------|----------|
| kill switch | 设置 env 后重启，确认页面走 legacy 路径 | 页面正常渲染，无报错 |
| 损坏新快照 | 手动写坏 `*-snapshot-envelope.v1.json` 后重启 | 页面回退空态/last-known-good，无白屏 |
| 磁盘写失败 | 只读目录模拟 | 保留原文件，返回 LKG，记录错误码 |
| collector 卡死 | 注入超时 collector | 超时后无残留 worker/子进程/延迟 commit |
| 旧版本 downgrade | 安装上一版安装包 | 旧版本读取旧文件正常 |

## 3. 演练证据模板（每次演练后填写）

```markdown
## 演练记录：<版本> <日期>

- 演练项：<kill switch / 损坏快照 / 写失败 / collector 卡死 / downgrade>
- 环境：<OS / 数据量>
- 步骤与结果：
  1. ...
- 结论：PASS / FAIL（失败原因与修复：...）
- 证据：<测试输出路径 / 截图>
```

## 4. 已完成的自动演练证据（T7-07 部分）

以下演练已由自动化测试覆盖（无需人工执行，随 CI 每次运行）：

| 演练 | 测试文件 | 断言 |
|------|----------|------|
| 损坏快照恢复 | `coordinator.test.ts` "corrupt snapshot recovers to empty" | 状态回到 empty，读取不崩溃 |
| 失败保留 LKG | `coordinator.test.ts` / `usage-envelope.server.test.ts` | 数据不变、revision 不变、warning code |
| 取消后无提交 | `coordinator.test.ts` "abort before commit" | 零写入 |
| 写失败 LKG | `coordinator.test.ts`（write failure 路径） | 保留旧数据 |
| 单次 hydrate | `coordinator.test.ts` "concurrent first reads" | 磁盘只读一次 |
| 汇率离线降级 | `exchange-rate.test.ts` | stale-cache / fallback |
| WSL 不可用降级 | `wsl-topology.server.test.ts` | 空拓扑，不抛错 |
| 任务取消释放 | `scheduler.test.ts` "cancelled heavy task releases" | permit 不泄漏 |

人工演练（kill switch 重启、真实 downgrade）需在 RC 阶段按 §2 执行并填写 §3 模板。
