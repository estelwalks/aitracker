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
} as const;
