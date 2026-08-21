/**
 * Jarvis 今日洞察共享卡片的模板文案。数字一律来自真实 server fn 返回的
 * 结构化洞察描述（见 src/lib/page-insights/），展示层经 `t()` 拼装，
 * 不依赖任何 LLM 或写死数字。
 */
export const insights = {
  title: "今日洞察",
  rotate: "切换洞察",
  dots: "洞察列表",
  sources: {
    empty: "暂无来源数据，扫描工具后这里会出现真实洞察。",
    coverage: "已接入 {connected} / {total} 个工具，接入率 {rate}。",
    events: "已采集 {events} 个事件，数据可供分析与报表使用。",
    notInstalled: "{count} 个工具尚未安装，可前往官网下载接入。",
    noLogs: "{count} 个工具暂无日志，无法采集用量。",
    malformed: "{count} 行异常数据待排查，建议检查日志格式。",
    allGood: "全部 {total} 个工具状态正常，无异常日志。",
  },
  tracker: {
    empty: "暂无用量数据，扫描后这里会出现真实洞察。",
    burn: "累计消耗 {tokens} tokens，采集 {events} 个事件。",
    wasteLeader: "浪费指数最高：{name} · {waste}，值得关注。",
    cacheLow: "缓存命中最低：{name} · {rate}，建议复用上下文。",
    suggestCount: "共 {count} 项消耗建议可优化，详见燃烧榜。",
    topBurn: "消耗最高：{name} · {tokens} tokens。",
  },
  actions: {
    security: "查看安全",
    distill: "去蒸馏",
    reports: "查看日报",
    sessions: "查看会话",
    sources: "数据来源",
    settings: "模型设置",
    tracker: "查看燃烧榜",
    market: "安全市场",
    skills: "技能库",
    memory: "记忆库",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "今天 {agents} 个 Agent 值守，已拦截 {blocked} 次风险，节省约 {hours} 小时，还有 {distillable} 段会话可蒸馏。",
      "dashboard-assets":
        "主力 Agent「{name}」承担了 {rate} 的用量，其余 Agent 使用较少，可考虑均衡分配。",
      "dashboard-usage":
        "今日已采集 {events} 个用量事件、共 {sessions} 段会话，可前往会话页查看详情或发起蒸馏。",
      "dashboard-security-safe":
        "今日未发现安全风险，所有已扫描项目均通过检查。",
      "dashboard-security-risk":
        "今日发现 {count} 项安全风险待处理，建议前往安全页复查。",
      "dashboard-efficiency":
        "「{name}」缓存命中率仅 {rate}，建议复用上下文以降低成本。",
      "dashboard-empty": "还没有采集到任何会话数据，去数据来源接入本地 Agent。",
      "dashboard-guide-collection":
        "先确认数据来源持续采集中，首页结论才不会因采集断档而失真。",
      "dashboard-guide-sessions":
        "会话活跃度适合判断今天是否有值得复盘或继续推进的工作。",
      "dashboard-guide-concentration":
        "来源占比过于集中时，建议回看主力工具是否承担了不合适的任务。",
      "dashboard-guide-cache":
        "缓存效率反映上下文是否被有效复用，可结合燃烧榜继续定位。",
      "dashboard-guide-distill":
        "把今天可复用的会话送去蒸馏，能把一次成果变成长期资产。",
    },
    agents: {
      "agents-overview":
        "共 {count} 个 Agent 在值守，今日已拦截 {blocked} 次风险，节省约 {hours} 小时。",
      "agents-focus-prompt":
        "「{name}」的提示词重复度偏高，建议提炼公共指令以降低 token 消耗。",
      "agents-focus-cache":
        "「{name}」缓存命中率仅 {rate}，建议开启上下文复用。",
      "agents-focus-security":
        "「{name}」近期有 {count} 项风险操作，建议复查其权限与配置。",
      "agents-prompt-guide":
        "把提示词写得更具体，能显著减少重复读取与返工，节省 token。",
      "agents-guide-coverage":
        "工具覆盖决定 Agent 总览是否完整，可先补齐未接入的本地工具。",
      "agents-guide-activity":
        "结合活跃度与会话量，可以区分常用 Agent 和仅安装未使用的 Agent。",
      "agents-guide-prompt":
        "提示词结构应把稳定规则与临时任务分开，减少重复上下文。",
      "agents-guide-cache": "缓存结构能反映 Agent 是否在反复读取相同上下文。",
      "agents-guide-security":
        "Agent 的权限与 Skill 风险应一起复查，避免能力扩大后暴露面同步扩大。",
    },
    distill: {
      "distill-ready": "今天有 {count} 段会话可蒸馏，建议抽空归档为经验。",
      "distill-pending": "有 {count} 项蒸馏待审批，请及时确认或驳回。",
      "distill-quota": "蒸馏配额已使用 {rate}，请注意控制单日调用量。",
      "distill-empty": "今天还没有可蒸馏的会话。",
      "distill-focus":
        "已选素材越聚焦，蒸馏质量越高：一次挑 3~8 条强相关对话，比整段导入的产出好得多。",
      "distill-repeat": "大量重复问答可以固化成一个 Skill，少花不少 token。",
      "distill-guide-intake": "优先从完成度高、可复用的会话中挑选蒸馏素材。",
      "distill-guide-outputs":
        "产物类型应匹配复用方式：流程沉淀为工作流，稳定能力沉淀为 Skill。",
      "distill-guide-quota": "生成前先确认模型与额度，避免蒸馏任务在中途停下。",
      "distill-guide-reuse":
        "已通过审批的产物应进入知识或记忆资产，方便后续复用。",
      "distill-guide-start":
        "没有候选时，可先从会话页选择一段有明确结论的素材开始。",
    },
    reports: {
      "reports-highlights":
        "本期主力 Agent 是「{name}」，贡献了 {rate} 的用量。",
      "reports-security": "本期有 {count} 项安全事件待复查，建议纳入日报重点。",
      "reports-latest": "最近一份日报生成于 {time}，数据截至当前扫描。",
      "reports-empty": "本期暂无数据。",
      "reports-collab":
        "AI 先填、你再改、最后保存——日报只需要你确认结论，不用从零开始写。",
      "reports-next": "建议在日报里补一句「下一步计划」，汇总时会自动引用。",
      "reports-guide-inventory":
        "报告归档能帮助确认哪些周期已完成、哪些周期仍缺复盘。",
      "reports-guide-highlights":
        "先提炼成果与关键变化，再补明细，报告会更容易阅读。",
      "reports-guide-security":
        "安全事件应单独列入报告，避免被一般用量结论掩盖。",
      "reports-guide-workflow":
        "草稿、编辑、保存和导出是完整闭环，保存前应确认结论。",
      "reports-guide-next":
        "当前周期没有报告时，可从最近有会话活动的周期开始生成。",
    },
    memory: {
      "memory-total":
        "已沉淀 {count} 条记忆，其中画像 {profiles} 条、任务 {tasks} 条。",
      "memory-auto": "开启蒸馏自动沉淀后，经验会自动写入记忆库，无需手动整理。",
      "memory-empty": "记忆库还是空的，蒸馏会话后会自动沉淀经验。",
      "memory-kinds":
        "画像帮我记住你是谁、喜欢怎样；任务记忆帮我记住我们定过什么规矩。",
      "memory-guide-inventory":
        "记忆资产应保持可检索、可追溯，避免重要约定散落在会话里。",
      "memory-guide-approval":
        "审批后再发布记忆，可防止未经确认的内容进入长期上下文。",
      "memory-guide-hygiene":
        "定期清理过期或有风险的记忆，能降低错误上下文被反复复用的概率。",
      "memory-guide-types":
        "画像适合长期偏好，任务记忆适合具体约束，分开管理更清晰。",
      "memory-guide-distill":
        "记忆为空时，可从蒸馏工作台沉淀一条已确认的经验。",
    },
    security: {
      "security-risk-top": "检测到 {count} 条高危发现，请立即前往安全页处置。",
      "security-scan-gap":
        "仍有 {count} 个来源未被本次扫描覆盖，当前状态不能视为安全。",
      "security-scan-coverage":
        "本次扫描覆盖了 {rate} 的来源，剩余部分建议尽快补齐。",
      "security-last-scan": "上次完整扫描完成于 {time}，结果仅供参考。",
      "security-scan-first":
        "新装的技能建议先扫描再启用，这一步只要几秒，能挡掉绝大多数投毒式脚本。",
      "security-history":
        "扫描历史会留档，出问题时可以对比前后版本，快速定位是哪次更新引入的风险。",
      "security-guide-posture":
        "先处理高风险发现，再评估一般提醒，处置顺序不能被数量稀释。",
      "security-guide-failures":
        "扫描失败代表存在检查盲区，不能等同于未发现风险。",
      "security-guide-coverage":
        "覆盖范围应包含实际启用的 Skill 与配置，遗漏项需要补扫。",
      "security-guide-recency":
        "旧扫描只能说明当时状态，更新或安装后应重新检查。",
      "security-guide-scan":
        "还没有扫描结果时，先发起一次本地静态扫描建立安全基线。",
    },
    tracker: {
      "tracker-burn-leader": "消耗最高：「{name}」，累计 {tokens} tokens。",
      "tracker-waste-leader": "浪费指数最高：「{name}」· {rate}，值得关注。",
      "tracker-cache-low": "缓存命中最低：「{name}」· {rate}，建议复用上下文。",
      "tracker-suggest": "共 {count} 项消耗建议可优化，详见燃烧榜。",
      "tracker-top-model":
        "「{name}」吃掉了最多 tokens，轻量任务可以换更小的模型处理。",
      "tracker-top-project":
        "项目维度看，「{name}」消耗占比最高，可针对它单独优化提示词模板。",
      "tracker-empty": "暂时没有明显的浪费项。",
      "tracker-guide-consumption":
        "先看总消耗与事件活跃度，再判断变化是否来自真实工作量。",
      "tracker-guide-waste": "浪费诊断应优先关注重复读取、返工和过度输出。",
      "tracker-guide-cache": "缓存命中偏低通常意味着稳定上下文没有被有效复用。",
      "tracker-guide-concentration":
        "模型或项目消耗过于集中时，适合单独拆解任务与提示词。",
      "tracker-guide-optimize":
        "优化后继续观察同一时间范围，才能判断调整是否真正生效。",
    },
    skills: {
      "skills-local": "本地共有 {count} 个 Skill 可用。",
      "skills-enabled": "其中 {count} 个已启用，其余可按需开启。",
      "skills-unscanned":
        "有 {count} 个 Skill 尚未扫描，建议先扫描确认安全再启用。",
      "skills-sync":
        "同一个 Skill 只装在部分 Agent 里会造成结果不一致，用一键同步补齐更省心。",
      "skills-specific": "Skill 写得越具体，模型越不容易跑偏，也就越省 token。",
      "skills-guide-inventory":
        "先盘点本地 Skill 数量与来源，避免重复能力长期并存。",
      "skills-guide-enablement":
        "只启用当前需要的 Skill，能减少 Agent 的无关能力暴露。",
      "skills-guide-coverage":
        "跨 Agent 覆盖不一致时，同一任务可能得到不同结果。",
      "skills-guide-updates":
        "待更新 Skill 应先查看变更，再决定是否同步到各 Agent。",
      "skills-guide-safety":
        "新增或变更后的 Skill 应重新扫描，安全结论不能沿用旧版本。",
    },
    market: {
      "market-installed": "已安装 {count} 个市场组件。",
      "market-updates": "发现 {count} 个组件有可用更新，建议及时升级。",
      "market-scan-first": "安装新组件前，请先完成安全扫描再启用。",
      "market-review": "安装前先看 SKILL.md 与版本记录，避免装到废包。",
      "market-guide-installs":
        "本地安装状态用于区分已拥有能力与待选能力，避免重复安装。",
      "market-guide-updates":
        "市场更新应先核对版本变化，再覆盖本地正在使用的组件。",
      "market-guide-cache":
        "市场目录来自本地缓存时仍可浏览，但内容可能不是最新状态。",
      "market-guide-review":
        "市场只提供候选，安装前仍需完成内容审查与安全检查。",
      "market-guide-install":
        "没有已安装组件时，可从明确用途且通过审查的条目开始。",
    },
    chats: {
      "chats-total": "共采集到 {count} 段会话。",
      "chats-top-source": "会话最多的来源是「{name}」，可重点关注其用量。",
      "chats-recoverable": "有 {count} 段会话可恢复，建议归档或蒸馏。",
      "chats-empty": "暂无会话数据，接入数据来源后即可查看。",
      "chats-resume":
        "恢复命令会带上项目路径，粘贴到终端就能回到原来的工作目录。",
      "chats-distill":
        "值得复用的会话记得丢进蒸馏工作台，沉淀成 Skill 比翻历史更快。",
      "chats-guide-inventory":
        "会话清单只汇总安全元数据，适合先定位再进入详情。",
      "chats-guide-sources":
        "按来源筛选可以快速发现哪些 Agent 有活动或采集断档。",
      "chats-guide-recovery":
        "可恢复会话应先确认状态，再决定继续、归档或蒸馏。",
      "chats-guide-activity":
        "轮次与 token 活跃度能帮助筛出值得继续复盘的会话。",
      "chats-guide-distill":
        "没有会话时先检查数据来源；有结论后再选择素材去蒸馏。",
    },
    "chat-detail": {
      "chat-detail-turns": "当前会话共 {count} 轮，元数据已完整采集。",
      "chat-detail-tokens": "本次会话累计消耗 {tokens} tokens。",
      "chat-detail-recoverable": "该会话可恢复或蒸馏为经验，建议在详情页发起。",
      "chat-detail-resume":
        "可恢复该会话继续之前的上下文，恢复命令会带上项目路径。",
      "chat-detail-guide-turns": "轮次能反映会话推进深度，但不代表结论质量。",
      "chat-detail-guide-tokens":
        "token 活动适合判断上下文规模，并辅助识别异常膨胀。",
      "chat-detail-guide-state":
        "会话状态与采集新鲜度应一起判断，避免基于过期元数据操作。",
      "chat-detail-guide-recovery":
        "只有满足恢复条件的会话才应执行恢复，其他状态保留只读查看。",
      "chat-detail-guide-distill":
        "结论清晰且可复用时，可从详情页发起蒸馏而不读取敏感正文。",
    },
    widget: {
      "widget-broadcast-security": "今日安全：发现 {count} 项风险待处理。",
      "widget-broadcast-efficiency":
        "今日效率：「{name}」缓存命中率最低，仅 {rate}。",
      "widget-broadcast-distill": "今日蒸馏：有 {count} 段会话待蒸馏。",
    },
    settings: {
      "settings-model-unconfigured":
        "模型尚未配置，前往模型设置完成接入后即可使用增强洞察。",
      "settings-scan-plan": "扫描计划覆盖 {count} 个数据来源，可在此调整计划。",
      "settings-collection":
        "数据采集完整度为 {rate}，不足部分可在此排查来源。",
      "settings-local":
        "数据采集全部在本地完成，不上传会话内容；可在数据来源设置中调整采集范围。",
      "settings-guide-model":
        "模型配置需要同时具备可用 Profile 与有效凭据，才能执行增强分析。",
      "settings-guide-enhancement":
        "今日洞察增强开关只控制模型改写，规则洞察始终可以本地运行。",
      "settings-guide-schedules":
        "定时任务应按实际需要开启，避免重复采集或扫描。",
      "settings-guide-retention":
        "保留周期决定本地历史范围，调整前应确认仍需追溯的数据。",
      "settings-guide-privacy":
        "配置与业务数据保存在本地，清除数据前需要确认影响范围。",
    },
    sources: {
      "sources-connected": "已接入 {count} 个数据来源。",
      "sources-malformed": "有 {count} 行异常数据待排查，建议检查日志格式。",
      "sources-not-installed": "{count} 个工具尚未安装，可前往官网下载接入。",
      "sources-all-good": "全部 {count} 个来源状态正常，无异常日志。",
      "sources-rescan":
        "工具目录变动后记得重新扫描，否则会话与技能的采集会出现断档。",
      "sources-local": "所有采集都在本地完成，不会把会话内容上传到任何地方。",
      "sources-guide-inventory":
        "接入清单用于确认工具是否被探测，不代表已经产生可分析日志。",
      "sources-guide-availability":
        "已安装、有日志和有可用事件是不同状态，需要分别判断。",
      "sources-guide-logs":
        "无日志来源不会产生用量洞察，可先确认工具是否有真实活动。",
      "sources-guide-rescan":
        "目录或安装状态变化后重新扫描，才能刷新采集边界。",
      "sources-guide-privacy":
        "来源页只展示聚合状态与异常计数，不上传会话正文或本地路径。",
    },
  },
} as const;
