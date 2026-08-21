const EMPTY_GENERIC_ANALYSIS_PATTERNS = [
  /^(?:请|建议|可|需要|应)?(?:持续|继续)?(?:关注|观察|留意|监控|优化|改进|处理|检查|确认)(?:相关|当前|此项|情况|状态|问题|数据|指标|表现)*(?:即可|为宜)?$/u,
  /^(?:please\s+)?(?:continue\s+to\s+)?(?:monitor|review|check|confirm|optimi[sz]e|improve)(?:\s+(?:the|this|current|related))?(?:\s+(?:status|data|metric|situation|issue))?$/i,
  /采集断档/u,
  /(?:确认|检查|确保).{0,16}(?:数据来源?|数据源|采集).{0,16}(?:持续|正常|完整|运行|可用)/u,
  /(?:数据来源?|数据源|采集).{0,16}(?:持续采集|采集正常|正常运行)/u,
  /(?:补齐|安装|接入).{0,16}(?:未接入|缺失|全部|所有)?(?:的)?(?:本地)?工具/u,
  /(?:为了?|以使|可使).{0,12}(?:总览|概览|覆盖).{0,12}(?:完整|更完整)/u,
  /(?:ensure|confirm|check).{0,24}(?:data source|collection).{0,24}(?:continu|running|complete|available)/i,
  /(?:install|connect|add|complete).{0,24}(?:all|missing|unconnected)?.{0,12}tools?.{0,24}(?:coverage|overview|complete)/i,
] as const;

const UNKNOWN_VALUE_PATTERN =
  /(?:未知|不可用|无法获取|无法观测|暂无数据|没有数据|未采集|未提供|不适用|unknown|unavailable|not available|no data|n\/a|未計測|不明|データなし|알 수 없|데이터 없음)/i;
const ZERO_VALUE_INTERPRETATION_PATTERN =
  /(?:为零|是零|零命中|没有任何|极低|非常低|zero|none|no\s+(?:usage|hits?|activity)|very low|extremely low|ゼロ|非常に低|없음|매우 낮)/i;

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
}

function characterNgrams(value: string, width: number): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index <= value.length - width; index += 1) {
    grams.add(value.slice(index, index + width));
  }
  return grams;
}

function overlapSize(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) overlap += 1;
  }
  return overlap;
}

/**
 * Deterministic quality gate for model-provided analysis. It rejects close
 * paraphrases of the rendered fact, unverifiable collection/setup guidance,
 * empty boilerplate, and interpretations that turn an explicitly unknown
 * value into zero. The fact itself is never affected.
 */
export function isInsightAnalysisUseful(
  fact: string,
  analysis: string | null | undefined,
): boolean {
  const trimmed = analysis?.trim() ?? "";
  if (trimmed === "") return false;
  if (
    EMPTY_GENERIC_ANALYSIS_PATTERNS.some((pattern) => pattern.test(trimmed))
  ) {
    return false;
  }
  if (
    UNKNOWN_VALUE_PATTERN.test(fact) &&
    ZERO_VALUE_INTERPRETATION_PATTERN.test(trimmed)
  ) {
    return false;
  }

  const normalizedFact = normalizeComparableText(fact);
  const normalizedAnalysis = normalizeComparableText(trimmed);
  if (normalizedAnalysis.length < 4) return false;
  if (normalizedFact.length < 4) return true;
  if (
    normalizedFact.includes(normalizedAnalysis) ||
    normalizedAnalysis.includes(normalizedFact)
  ) {
    return false;
  }

  const factGrams = characterNgrams(normalizedFact, 2);
  const analysisGrams = characterNgrams(normalizedAnalysis, 2);
  const overlap = overlapSize(factGrams, analysisGrams);
  const smallerSize = Math.min(factGrams.size, analysisGrams.size);
  const unionSize = factGrams.size + analysisGrams.size - overlap;
  const containment = smallerSize === 0 ? 0 : overlap / smallerSize;
  const jaccard = unionSize === 0 ? 0 : overlap / unionSize;
  return containment < 0.68 && jaccard < 0.5;
}
