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

const SPECULATIVE_ANALYSIS_PATTERNS = [
  /(?:可能|或许|大概|疑似|推测|猜测|也许|似乎|或反映|或说明)/u,
  /\b(?:may|might|likely|possibly|perhaps|presumably)\b/i,
  /\bcould\s+(?:reflect|indicate|mean|suggest|result\s+from|be\s+caused)/i,
] as const;

const EXTERNAL_BENCHMARK_PATTERNS = [
  /(?:常见|通常|一般水平|正常水平|行业水平|行业基准|普遍水平|外部基准|远高于|显著高于|明显高于|远低于|显著低于|明显低于)/u,
  /\b(?:common|typical|normal|industry|benchmark|baseline|far\s+(?:above|below)|significantly\s+(?:above|below|higher|lower))\b/i,
] as const;

const NO_CONCLUSION_PATTERNS = [
  /需(?:要)?结合/u,
  /需(?:要)?进一步(?:判断|分析|区分|确认|观察|核对|评估)/u,
  /(?:无法|不能|难以|尚难|尚不能).{0,16}(?:判断|确认|确定|评估|区分|得出结论)/u,
  /(?:不足以|尚不足以).{0,12}(?:判断|确认|确定|评估|得出结论)/u,
  /(?:有待|仍需|需要更多|还需更多).{0,16}(?:确认|核对|数据|信息|分析|观察)/u,
  /需(?:要)?核对(?:清单|配置|权限|状态|数据|信息)/u,
  /需(?:要)?评估.{0,20}(?:配置|价值|覆盖|状态|存量|差异)/u,
  /(?:可据此|据此可)(?:判断|确认|评估|推断)/u,
  /(?:当前仅|现有(?:仅|只))(?:提供|包含|有).{0,20}(?:维度|数据|信息)/u,
  /(?:无需|不必|不要).{0,20}(?:做|进行)?(?:任何)?假设/u,
  /\b(?:need|requires?)\s+(?:more|additional|further)\s+(?:data|information|analysis|investigation|review|confirmation)\b/i,
  /\b(?:cannot|unable\s+to|not\s+enough\s+to)\s+(?:determine|confirm|conclude|assess|distinguish)\b/i,
  /\b(?:only|currently only)\s+(?:provides?|contains?|includes?)\s+(?:a\s+)?(?:total|aggregate)?\s*(?:dimension|view|metric)\b/i,
  /\b(?:do\s+not|don't|need\s+not)\s+(?:make\s+)?assumptions?\b/i,
] as const;

const EVENT_METRIC_PATTERN = /(?:事件(?:量|数)?|\bevents?\b)/iu;

const RATIO_CLAIM_PATTERN =
  /(?:[零〇一二两三四五六七八九十百千万亿]+分之[零〇一二两三四五六七八九十百千万亿]+|仅(?:有)?少数|只有少数|绝大多数|大多数|多数|少数|半数|过半|超过一半|不到一半|\b(?:majority|minority|most|few|three[- ]quarters?|two[- ]thirds?|half)\b)/iu;
const RATIO_FACT_SUPPORT_PATTERN =
  /(?:%|百分之|[零〇一二两三四五六七八九十百千万亿]+分之[零〇一二两三四五六七八九十百千万亿]+|占(?:总|全部|整体)|绝大多数|大多数|多数|少数|半数|过半|超过一半|不到一半|\b(?:percentage|percent|majority|minority|three[- ]quarters?|two[- ]thirds?|half)\b)/iu;

const SUBJECTIVE_LEVEL_CLAIM_PATTERN =
  /(?:较高|偏高|过高|很高|较低|偏低|过低|很低|覆盖度高|差异明显|明显差异)/u;
const SUBJECTIVE_LEVEL_FACT_SUPPORT_PATTERN =
  /(?:较高|偏高|过高|很高|较低|偏低|过低|很低|覆盖度高|差异明显|明显差异|高于.{0,12}(?:阈值|上限|基准)|低于.{0,12}(?:阈值|下限|基准)|超过.{0,12}(?:阈值|上限)|达到.{0,12}(?:阈值|上限))/u;

const FIXED_STATE_CLAIM_PATTERN =
  /(?:(?:数量|总量|范围|状态|规模).{0,8}(?:已)?固定|当前.{0,12}已固定)/u;
const FIXED_STATE_FACT_SUPPORT_PATTERN = /(?:固定|不变|保持稳定)/u;

const CONFIG_OR_PERMISSION_CLAIM_PATTERN =
  /(?:(?:配置|权限).{0,8}(?:状态|差异|价值|问题|原因|影响)|(?:状态|差异|价值|问题|原因|影响).{0,8}(?:配置|权限))/u;
const CONFIG_OR_PERMISSION_FACT_SUPPORT_PATTERN = /(?:配置|权限)/u;

const LIMITED_QUANTITY_CLAIM_PATTERN =
  /(?:(?:数量|数目|规模).{0,4}(?:有限|受限)|\blimited\s+(?:number|count|volume)\b)/iu;
const LIMITED_QUANTITY_FACT_SUPPORT_PATTERN =
  /(?:有限|受限|少量|少数|不多|\blimited\b|\bfew\b)/iu;

const AVERAGE_PER_CLAIM_PATTERN =
  /平均每(?:段|个|次|场).{0,16}(?:事件|会话|消息|Token|令牌|用量|消耗)/iu;
const AVERAGE_PER_FACT_PATTERN = /(?:平均每|每(?:段|个|次|场).{0,8}平均)/u;
const TOTAL_CONTRIBUTION_CLAIM_PATTERN =
  /(?:贡献|覆盖|产生|占据)(?:了)?(?:全部|所有|完整|百分之百).{0,16}(?:事件|会话|消息|Token|令牌|用量|消耗)/iu;
const TOTAL_CONTRIBUTION_FACT_PATTERN = /(?:全部|所有|百分之百|100\s*%)/u;

function hasUnsupportedCrossCandidateClaim(
  fact: string,
  analysis: string,
): boolean {
  if (
    AVERAGE_PER_CLAIM_PATTERN.test(analysis) &&
    !AVERAGE_PER_FACT_PATTERN.test(fact)
  ) {
    return true;
  }
  return (
    TOTAL_CONTRIBUTION_CLAIM_PATTERN.test(analysis) &&
    !TOTAL_CONTRIBUTION_FACT_PATTERN.test(fact)
  );
}

function hasUnsupportedDerivedConclusion(
  fact: string,
  analysis: string,
): boolean {
  if (
    RATIO_CLAIM_PATTERN.test(analysis) &&
    !RATIO_FACT_SUPPORT_PATTERN.test(fact)
  ) {
    return true;
  }
  if (
    SUBJECTIVE_LEVEL_CLAIM_PATTERN.test(analysis) &&
    !SUBJECTIVE_LEVEL_FACT_SUPPORT_PATTERN.test(fact)
  ) {
    return true;
  }
  if (
    FIXED_STATE_CLAIM_PATTERN.test(analysis) &&
    !FIXED_STATE_FACT_SUPPORT_PATTERN.test(fact)
  ) {
    return true;
  }
  if (
    LIMITED_QUANTITY_CLAIM_PATTERN.test(analysis) &&
    !LIMITED_QUANTITY_FACT_SUPPORT_PATTERN.test(fact)
  ) {
    return true;
  }
  return (
    CONFIG_OR_PERMISSION_CLAIM_PATTERN.test(analysis) &&
    !CONFIG_OR_PERMISSION_FACT_SUPPORT_PATTERN.test(fact)
  );
}

function introducesUngroundedMetric(fact: string, analysis: string): boolean {
  return (
    EVENT_METRIC_PATTERN.test(analysis) && !EVENT_METRIC_PATTERN.test(fact)
  );
}

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
 * speculation, assumed external benchmarks, inconclusive filler, unsupported
 * cross-candidate calculations, and interpretations that turn an explicitly
 * unknown value into zero. The fact itself is never affected.
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
    SPECULATIVE_ANALYSIS_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    EXTERNAL_BENCHMARK_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    NO_CONCLUSION_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    introducesUngroundedMetric(fact, trimmed) ||
    hasUnsupportedCrossCandidateClaim(fact, trimmed) ||
    hasUnsupportedDerivedConclusion(fact, trimmed)
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
