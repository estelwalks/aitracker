/**
 * Jarvis 今日洞察共享卡片的模板文案。数字一律来自真实 server fn 返回的
 * 结构化洞察描述（见 src/lib/page-insights/），展示层经 `t()` 拼装，
 * 不依赖任何 LLM 或写死数字。
 */
export const insights = {
  title: "今日洞察",
  rotate: "换一条",
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
        "当前已汇总 {skills} 个 Skill 资产和 {knowledge} 条知识资产。",
      "dashboard-assets": "用量最高的 Agent「{name}」占总 Token 的 {rate}。",
      "dashboard-usage": "当前范围内共采集 {events} 个用量事件。",
      "dashboard-security-safe":
        "今日未发现安全风险，所有已扫描项目均通过检查。",
      "dashboard-security-risk":
        "今日发现 {count} 项安全风险待处理，建议前往安全页复查。",
      "dashboard-efficiency":
        "「{name}」缓存命中率仅 {rate}，建议复用上下文以降低成本。",
      "dashboard-empty": "还没有采集到任何会话数据，去数据来源接入本地 Agent。",
      "dashboard-guide-collection": "当前范围内累计消耗 {tokens} tokens。",
      "dashboard-guide-sessions": "当前范围内共记录 {count} 段 AI 会话。",
      "dashboard-guide-concentration":
        "每个用量事件平均消耗 {average} tokens。",
      "dashboard-guide-cache": "当前范围内共采集 {events} 个用量事件。",
      "dashboard-guide-distill":
        "当前有 {count} 个 Agent 产生了可统计的用量事件。",
    },
    agents: {
      "agents-overview":
        "已检测到 {count} 个现有 Agent，其中 {active} 个有用量事件、{inactive} 个暂无事件。",
      "agents-focus-prompt":
        "「{name}」的提示词重复度偏高，建议提炼公共指令以降低 token 消耗。",
      "agents-focus-cache":
        "「{name}」缓存命中率仅 {rate}，建议开启上下文复用。",
      "agents-focus-security":
        "其中 {available} 个现有 Agent 的本地数据当前可读取。",
      "agents-prompt-guide":
        "用量最高的现有 Agent「{name}」占总 Token 的 {rate}。",
      "agents-guide-coverage":
        "当前检测到 {count} 个已安装、可读取或已有事件的 Agent。",
      "agents-guide-activity": "现有 Agent 共记录 {count} 段会话。",
      "agents-guide-prompt":
        "现有 Agent 共产生 {events} 个用量事件，累计 {tokens} tokens。",
      "agents-guide-cache": "其中 {available} 个 Agent 的本地数据当前可读取。",
      "agents-guide-security": "当前有 {count} 个现有 Agent 产生了用量事件。",
    },
    distill: {
      "distill-ready": "今天有 {count} 段会话可蒸馏，建议抽空归档为经验。",
      "distill-pending": "有 {count} 项蒸馏待审批，请及时确认或驳回。",
      "distill-quota": "蒸馏配额已使用 {rate}，请注意控制单日调用量。",
      "distill-empty": "今天还没有可蒸馏的会话。",
      "distill-focus":
        "已选素材越聚焦，蒸馏质量越高：一次挑 3~8 条强相关对话，比整段导入的产出好得多。",
      "distill-repeat": "大量重复问答可以固化成一个 Skill，少花不少 token。",
      "distill-guide-intake": "今日蒸馏调用已使用 {used} / {limit} 次。",
      "distill-guide-outputs": "蒸馏工作台当前已沉淀 {count} 条知识资产。",
      "distill-guide-quota": "今日还可执行 {count} 次蒸馏调用。",
      "distill-guide-reuse": "当前有 {count} 项蒸馏结果处于待审批状态。",
      "distill-guide-start": "当前蒸馏候选队列共有 {count} 项。",
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
      "reports-guide-inventory": "报告库当前共保存 {total} 份报告。",
      "reports-guide-highlights": "其中日报 {daily} 份、周报 {weekly} 份。",
      "reports-guide-security": "当前有 {count} 份报告处于草稿状态。",
      "reports-guide-workflow": "当前有 {count} 份报告已审批。",
      "reports-guide-next": "当前有 {count} 份报告已归档。",
    },
    memory: {
      "memory-total":
        "已沉淀 {count} 条记忆，其中画像 {profiles} 条、任务 {tasks} 条。",
      "memory-auto": "开启蒸馏自动沉淀后，经验会自动写入记忆库，无需手动整理。",
      "memory-empty": "记忆库还是空的，蒸馏会话后会自动沉淀经验。",
      "memory-kinds":
        "画像帮我记住你是谁、喜欢怎样；任务记忆帮我记住我们定过什么规矩。",
      "memory-guide-inventory": "记忆库当前共保存 {count} 条资产。",
      "memory-guide-approval": "其中 {approved} 条记忆已审批或发布。",
      "memory-guide-hygiene": "当前有 {unsafe} 条记忆被标记为可疑或危险。",
      "memory-guide-types": "当前有 {pending} 条记忆尚未审批或发布。",
      "memory-guide-distill": "当前有 {safe} 条记忆未被标记为安全风险。",
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
        "最近一次安全摘要记录了 {risky} 项可疑或危险资产。",
      "security-guide-failures": "最近一次扫描有 {failed} 个资产检查失败。",
      "security-guide-coverage":
        "最近一次扫描发现 {discovered} 个资产，已评估 {assessed} 个。",
      "security-guide-recency": "最近一次安全摘要生成于 {time}。",
      "security-guide-scan": "最近一次扫描有 {clean} 个资产通过检查。",
    },
    tracker: {
      "tracker-burn-leader": "消耗最高：「{name}」，累计 {tokens} tokens。",
      "tracker-waste-leader": "浪费指数最高：「{name}」· {rate}，值得关注。",
      "tracker-cache-low": "缓存命中最低：「{name}」· {rate}，建议复用上下文。",
      "tracker-suggest": "共 {count} 项消耗建议可优化，详见燃烧榜。",
      "tracker-top-model": "当前范围内 Token 消耗最高的模型是「{name}」。",
      "tracker-top-project": "当前范围内 Token 消耗最高的项目是「{name}」。",
      "tracker-empty": "暂时没有明显的浪费项。",
      "tracker-guide-consumption":
        "当前范围内 {events} 个事件累计消耗 {tokens} tokens。",
      "tracker-guide-waste": "浪费指数最高的来源是「{name}」，指数为 {rate}。",
      "tracker-guide-cache": "当前有 {count} 个来源提供可验证的缓存字段。",
      "tracker-guide-concentration":
        "Token 消耗最高的来源「{name}」占总量的 {rate}。",
      "tracker-guide-optimize": "每个用量事件平均消耗 {average} tokens。",
    },
    skills: {
      "skills-local": "本地共有 {count} 个 Skill 可用。",
      "skills-enabled": "其中 {count} 个已启用，其余可按需开启。",
      "skills-unscanned":
        "有 {count} 个 Skill 尚未扫描，建议先扫描确认安全再启用。",
      "skills-sync":
        "同一个 Skill 只装在部分 Agent 里会造成结果不一致，用一键同步补齐更省心。",
      "skills-specific": "Skill 写得越具体，模型越不容易跑偏，也就越省 token。",
      "skills-guide-inventory": "本地 Skill 快照共记录 {count} 个 Skill。",
      "skills-guide-enablement":
        "其中 {enabled} 个 Skill 至少安装到一个 Agent。",
      "skills-guide-coverage": "当前检测到 {agents} 个已安装的 Agent。",
      "skills-guide-updates": "当前有 {outdated} 个 Skill 安装项存在可用更新。",
      "skills-guide-safety":
        "当前有 {unassigned} 个 Skill 尚未安装到任何 Agent。",
    },
    market: {
      "market-installed": "已安装 {count} 个市场组件。",
      "market-updates": "发现 {count} 个组件有可用更新，建议及时升级。",
      "market-scan-first": "安装新组件前，请先完成安全扫描再启用。",
      "market-review": "安装前先看 SKILL.md 与版本记录，避免装到废包。",
      "market-guide-installs": "当前已安装 {installed} 个来自市场的 Skill。",
      "market-guide-updates": "其中 {updates} 个市场 Skill 存在可用更新。",
      "market-guide-cache": "本地市场缓存包含 {total} 个可浏览条目。",
      "market-guide-review":
        "已安装的市场 Skill 中有 {current} 个当前无待更新版本。",
      "market-guide-install": "当前市场缓存距抓取时间约 {hours} 小时。",
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
      "chats-guide-inventory": "会话快照当前共记录 {count} 段会话。",
      "chats-guide-sources": "这些会话来自 {count} 个 Agent 来源。",
      "chats-guide-recovery": "当前有 {count} 段会话具备可恢复状态。",
      "chats-guide-activity": "全部会话累计 {turns} 轮、消耗 {tokens} tokens。",
      "chats-guide-distill": "全部会话累计活跃时长约 {minutes} 分钟。",
    },
    "chat-detail": {
      "chat-detail-turns": "当前会话共 {count} 轮，元数据已完整采集。",
      "chat-detail-tokens": "本次会话累计消耗 {tokens} tokens。",
      "chat-detail-recoverable": "该会话可恢复或蒸馏为经验，建议在详情页发起。",
      "chat-detail-resume":
        "可恢复该会话继续之前的上下文，恢复命令会带上项目路径。",
      "chat-detail-guide-turns": "当前会话记录了 {count} 个重试轮次。",
      "chat-detail-guide-tokens": "当前会话记录了 {count} 次子 Agent 调用。",
      "chat-detail-guide-state":
        "当前会话来自「{source}」，本地状态为「{status}」。",
      "chat-detail-guide-recovery": "当前会话有 {count} 个包含编辑操作的轮次。",
      "chat-detail-guide-distill": "当前会话累计活跃时长约 {minutes} 分钟。",
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
        "当前保存 {profiles} 个模型 Profile，其中 {ready} 个具备已配置凭据。",
      "settings-guide-enhancement": "当前共登记 {total} 项后台定时任务。",
      "settings-guide-schedules": "其中 {enabled} 项后台定时任务已启用。",
      "settings-guide-retention": "其中 {disabled} 项后台定时任务当前停用。",
      "settings-guide-privacy":
        "当前有 {ready} 个模型 Profile 具备可用凭据配置。",
    },
    sources: {
      "sources-connected": "已接入 {count} 个数据来源。",
      "sources-malformed": "有 {count} 行异常数据待排查，建议检查日志格式。",
      "sources-not-installed": "当前有 {count} 个探测来源尚无可分析事件。",
      "sources-all-good": "全部 {count} 个来源状态正常，无异常日志。",
      "sources-rescan":
        "工具目录变动后记得重新扫描，否则会话与技能的采集会出现断档。",
      "sources-local": "所有采集都在本地完成，不会把会话内容上传到任何地方。",
      "sources-guide-inventory": "来源快照当前包含 {total} 个注册表来源。",
      "sources-guide-availability":
        "其中 {available} 个来源的本地数据当前可读取。",
      "sources-guide-logs": "其中 {connected} 个来源已经产生可分析事件。",
      "sources-guide-rescan": "当前来源快照记录了 {malformed} 行格式异常数据。",
      "sources-guide-privacy":
        "安装探测快照当前识别到 {installed} 个已安装工具。",
    },
  },
} as const;
