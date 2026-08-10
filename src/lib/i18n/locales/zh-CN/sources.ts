export const sources = {
  metaDescription: "查看本机各 AI 工具的安装探测状态与日志采集情况。",
  pageHeader: "数据来源",
  pageHeaderDesc: "{count} 个 AI 工具的探测状态 · 更新于 {time}",
  status: {
    hasData: "有数据",
    noLogs: "无日志",
    notInstalled: "未安装",
  },
  parsing: {
    native: "原生支持",
    adapter: "适配器支持",
    unsupported: "待支持",
  },
  summary: {
    connected: "已接入 / 总探测",
    events: "采集事件总数",
    notInstalled: "未采集工具",
    noLogs: "无日志工具",
    malformed: "异常行数",
  },
  panelTitle: "工具探测状态",
  searchPlaceholder: "搜索工具名称",
  scanning: "扫描中",
  rescan: "重新扫描",
  empty: {
    title: "没有匹配的工具",
    desc: "调整筛选条件或搜索关键词后重试。",
  },
  row: {
    events: "采集事件 {count}",
    parsing: "日志解析：{label}",
    malformed: "异常 {count}",
    download: "下载安装 ↗",
    paths: "探测路径：{paths}",
  },
  toast: {
    rescanDone: "重新扫描完成",
  },
} as const;
