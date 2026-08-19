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
      "dashboard-security-safe":
        "今日未发现安全风险，所有已扫描项目均通过检查。",
      "dashboard-security-risk":
        "今日发现 {count} 项安全风险待处理，建议前往安全页复查。",
      "dashboard-efficiency":
        "「{name}」缓存命中率仅 {rate}，建议复用上下文以降低成本。",
      "dashboard-empty": "还没有采集到任何会话数据，去数据来源接入本地 Agent。",
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
    },
    distill: {
      "distill-ready": "今天有 {count} 段会话可蒸馏，建议抽空归档为经验。",
      "distill-pending": "有 {count} 项蒸馏待审批，请及时确认或驳回。",
      "distill-quota": "蒸馏配额已使用 {rate}，请注意控制单日调用量。",
      "distill-empty": "今天还没有可蒸馏的会话。",
    },
    reports: {
      "reports-highlights":
        "本期主力 Agent 是「{name}」，贡献了 {rate} 的用量。",
      "reports-security": "本期有 {count} 项安全事件待复查，建议纳入日报重点。",
      "reports-latest": "最近一份日报生成于 {time}，数据截至当前扫描。",
      "reports-empty": "本期暂无数据。",
    },
    memory: {
      "memory-total":
        "已沉淀 {count} 条记忆，其中画像 {profiles} 条、任务 {tasks} 条。",
      "memory-auto": "开启蒸馏自动沉淀后，经验会自动写入记忆库，无需手动整理。",
      "memory-empty": "记忆库还是空的，蒸馏会话后会自动沉淀经验。",
    },
    security: {
      "security-risk-top": "检测到 {count} 条高危发现，请立即前往安全页处置。",
      "security-scan-gap":
        "仍有 {count} 个来源未被本次扫描覆盖，当前状态不能视为安全。",
      "security-scan-coverage":
        "本次扫描覆盖了 {rate} 的来源，剩余部分建议尽快补齐。",
      "security-last-scan": "上次完整扫描完成于 {time}，结果仅供参考。",
    },
    tracker: {
      "tracker-burn-leader": "消耗最高：「{name}」，累计 {tokens} tokens。",
      "tracker-waste-leader": "浪费指数最高：「{name}」· {rate}，值得关注。",
      "tracker-cache-low": "缓存命中最低：「{name}」· {rate}，建议复用上下文。",
      "tracker-suggest": "共 {count} 项消耗建议可优化，详见燃烧榜。",
      "tracker-empty": "暂时没有明显的浪费项。",
    },
    skills: {
      "skills-local": "本地共有 {count} 个 Skill 可用。",
      "skills-enabled": "其中 {count} 个已启用，其余可按需开启。",
      "skills-unscanned":
        "有 {count} 个 Skill 尚未扫描，建议先扫描确认安全再启用。",
    },
    market: {
      "market-installed": "已安装 {count} 个市场组件。",
      "market-updates": "发现 {count} 个组件有可用更新，建议及时升级。",
      "market-scan-first": "安装新组件前，请先完成安全扫描再启用。",
    },
    chats: {
      "chats-total": "共采集到 {count} 段会话。",
      "chats-top-source": "会话最多的来源是「{name}」，可重点关注其用量。",
      "chats-recoverable": "有 {count} 段会话可恢复，建议归档或蒸馏。",
      "chats-empty": "暂无会话数据，接入数据来源后即可查看。",
    },
    "chat-detail": {
      "chat-detail-turns": "当前会话共 {count} 轮，元数据已完整采集。",
      "chat-detail-tokens": "本次会话累计消耗 {tokens} tokens。",
      "chat-detail-recoverable": "该会话可恢复或蒸馏为经验，建议在详情页发起。",
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
    },
    sources: {
      "sources-connected": "已接入 {count} 个数据来源。",
      "sources-malformed": "有 {count} 行异常数据待排查，建议检查日志格式。",
      "sources-not-installed": "{count} 个工具尚未安装，可前往官网下载接入。",
      "sources-all-good": "全部 {count} 个来源状态正常，无异常日志。",
    },
  },
} as const;
