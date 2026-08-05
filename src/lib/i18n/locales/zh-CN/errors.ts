export const errors = {
  generic: "操作失败，请重试",
  skills: {
    emptyInput: "参数不能为空",
    batchPathsCount: "批量卸载路径数量不合法",
    batchPathsInvalid: "批量卸载路径不合法",
    installInvalid: "安装参数不合法",
    syncInvalid: "同步参数不合法",
    blacklistInvalid: "黑名单参数不合法",
  },
  sessions: {
    filterInvalid: "会话过滤参数不合法",
  },
  pricing: {
    modelListInvalid: "模型列表不合法",
  },
  market: {
    fieldInvalid: "市场接口字段 {field} 无效",
    pagingFieldInvalid: "市场接口分页字段 {field} 无效",
    invalidSkill: "市场接口返回了无效的 Skill 数据",
    missingPaging: "市场接口缺少分页信息",
    pagingRangeInvalid: "市场接口分页范围无效",
    invalidFormat: "市场接口返回格式无效",
    queryInvalid: "市场查询参数无效",
    pageNotPositive: "页码必须是正整数",
    limitRange: "每页数量必须在 1 到 50 之间",
    searchTooLong: "搜索关键词不能超过 100 个字符",
    sortInvalid: "排序参数无效",
    installInvalid: "安装参数无效",
  },
} as const;
