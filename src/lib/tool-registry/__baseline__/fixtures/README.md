# Parity fixtures (M0 baseline)

The frozen pre-migration reference for every tool fact source lives in
`baseline.ts` and is guarded by `baseline.test.ts`. It is the single parity
fixture for the four dimensions the migration must preserve:

| 维度                 | parity fixture                                                          | 比对对象（迁移后）                        |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| 工具探测 (detection) | `BASELINE_TOOLS` (id / nameZh / detectRoots) + `BASELINE_USAGE_PARSING` | registry `listTools()` + detection plan   |
| Skill roots          | `BASELINE_SKILL_AGENTS` (toolId / roots / envHome / markers / maxDepth) | registry `getSkillPlan()`                 |
| 价格                 | `BASELINE_MODEL_PRICES` (rates + matcher 语义) + `MODEL_BATTERY`        | registry `findModelRate({toolId, model})` |
| Session resume       | `BASELINE_SESSION_SOURCES` (roots + resumeCommandTemplate)              | registry `getSessionPlan()`               |

Usage-event parity (M4) reuses the anonymous JSON/JSONL/SQLite fixtures already
co-located in `src/lib/local-usage/**/*.test.ts`; new anonymous fixtures are
added there as needed when a Reader is migrated. No real user data or
conversation content is ever stored here - only anonymized structural samples.

**Rule:** any intentional diff against `baseline.ts` must be accompanied by an
`expected-diff.md` note (reason, owner, approval). Never edit baseline values to
make a test pass.
