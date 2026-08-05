export const errors = {
  generic: "Operation failed, please try again",
  skills: {
    emptyInput: "Input must not be empty",
    batchPathsCount: "Invalid batch uninstall path count",
    batchPathsInvalid: "Invalid batch uninstall paths",
    installInvalid: "Invalid install arguments",
    syncInvalid: "Invalid sync arguments",
    blacklistInvalid: "Invalid blacklist arguments",
  },
  sessions: {
    filterInvalid: "Invalid session filter",
  },
  pricing: {
    modelListInvalid: "Invalid model list",
  },
  market: {
    fieldInvalid: "Invalid market field: {field}",
    pagingFieldInvalid: "Invalid market paging field: {field}",
    invalidSkill: "The market returned an invalid Skill record",
    missingPaging: "The market response is missing paging info",
    pagingRangeInvalid: "Invalid market paging range",
    invalidFormat: "The market returned an invalid format",
    queryInvalid: "Invalid market query",
    pageNotPositive: "Page number must be a positive integer",
    limitRange: "Page size must be between 1 and 50",
    searchTooLong: "Search keyword must not exceed 100 characters",
    sortInvalid: "Invalid sort parameter",
    installInvalid: "Invalid install parameters",
  },
} as const;
