// AI 번역 초안, 검토 대기 (2026-08)
export const errors = {
  generic: "작업에 실패했습니다. 다시 시도해 주세요",
  skills: {
    emptyInput: "인자가 비어 있을 수 없습니다",
    batchPathsCount: "일괄 제거 경로 수가 올바르지 않습니다",
    batchPathsInvalid: "일괄 제거 경로가 올바르지 않습니다",
    installInvalid: "설치 인자가 올바르지 않습니다",
    syncInvalid: "동기화 인자가 올바르지 않습니다",
    blacklistInvalid: "블랙리스트 인자가 올바르지 않습니다",
  },
  sessions: {
    filterInvalid: "세션 필터가 올바르지 않습니다",
  },
  pricing: {
    modelListInvalid: "모델 목록이 올바르지 않습니다",
  },
  market: {
    fieldInvalid: "마켓 필드 {field}이(가) 유효하지 않습니다",
    pagingFieldInvalid: "마켓 페이지 매김 필드 {field}이(가) 유효하지 않습니다",
    invalidSkill: "마켓이 잘못된 Skill 데이터를 반환했습니다",
    missingPaging: "마켓 응답에 페이지 매김 정보가 없습니다",
    pagingRangeInvalid: "마켓 페이지 매김 범위가 유효하지 않습니다",
    invalidFormat: "마켓이 잘못된 형식을 반환했습니다",
    queryInvalid: "마켓 쿼리가 유효하지 않습니다",
    pageNotPositive: "페이지 번호는 양의 정수여야 합니다",
    limitRange: "페이지 크기는 1~50 사이여야 합니다",
    searchTooLong: "검색어는 100자를 초과할 수 없습니다",
    sortInvalid: "정렬 매개변수가 유효하지 않습니다",
    installInvalid: "설치 매개변수가 유효하지 않습니다",
  },
} as const;
