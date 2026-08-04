import type {
  AiFindingReview,
  AiReviewResult,
  SecurityRisk,
} from "./scanner.ts";

const MAX_RISKS = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const RATIONALE_MAX_CHARS = 200;

const VERDICTS = new Set<AiFindingReview["verdict"]>([
  "confirmed",
  "false-positive",
  "needs-context",
]);

interface AiReviewConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

interface ReviewOptions {
  config?: AiReviewConfig;
  fetcher?: typeof fetch;
}

function readConfig(): AiReviewConfig {
  return {
    endpoint: process.env.TRUSTTOOLS_AI_REVIEW_ENDPOINT?.trim(),
    apiKey: process.env.TRUSTTOOLS_AI_REVIEW_API_KEY?.trim(),
    model: process.env.TRUSTTOOLS_AI_REVIEW_MODEL?.trim(),
  };
}

function minimalRiskPayload(risks: SecurityRisk[]) {
  return risks.slice(0, MAX_RISKS).map((risk, index) => ({
    index,
    kind: risk.kind,
    severity: risk.severity,
    message: risk.message,
    excerpt: risk.excerpt.slice(0, 180),
  }));
}

/**
 * 解析模型返回的结构化每条命中研判。
 *
 * Clean-room 合规：解析的是模型对「已脱敏片段」的判定，不引入任何新的离机
 * 数据。模型可能不遵循 JSON 约定，故全程容错——解析失败即回退到 summary-only。
 */
function parseFindingVerdicts(
  content: string,
  expectedCount: number,
): AiFindingReview[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const findings: AiFindingReview[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const index = (entry as { index?: unknown }).index;
    const verdict = (entry as { verdict?: unknown }).verdict;
    const confidence = (entry as { confidence?: unknown }).confidence;
    const rationale = (entry as { rationale?: unknown }).rationale;
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    if (
      typeof verdict !== "string" ||
      !VERDICTS.has(verdict as AiFindingReview["verdict"])
    )
      continue;
    const clampedConfidence =
      typeof confidence === "number" && Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0;
    const rationaleText =
      typeof rationale === "string"
        ? rationale.slice(0, RATIONALE_MAX_CHARS)
        : "";
    findings.push({
      index,
      verdict: verdict as AiFindingReview["verdict"],
      confidence: clampedConfidence,
      rationale: rationaleText,
    });
  }

  // 仅在结构与数量基本匹配时采纳，避免模型漏判导致下标错位。
  if (findings.length === 0 || findings.length < Math.ceil(expectedCount / 2)) {
    return undefined;
  }
  return findings;
}

export async function reviewSecurityRisks(
  risks: SecurityRisk[],
  options: ReviewOptions = {},
): Promise<AiReviewResult> {
  const config = options.config ?? readConfig();
  if (!config.endpoint || !config.apiKey || !config.model) {
    return {
      status: "未配置",
      summary:
        "服务端未完整配置 AI endpoint、API key 和 model，已保留静态扫描结果。",
    };
  }

  const payload = minimalRiskPayload(risks);
  if (payload.length === 0) {
    return {
      status: "已完成",
      summary: "静态扫描未命中风险，因此没有向 AI 服务发送任何内容。",
    };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol))
      throw new Error("unsupported protocol");
  } catch {
    return {
      status: "未配置",
      summary: "AI endpoint 配置无效，已保留静态扫描结果。",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "你是安全审查助手。仅根据已脱敏的静态扫描命中片段，对每条命中给出结构化判定。输出必须是 JSON 数组，每个元素对应输入中的一条命中，按 index 字段匹配，形如 " +
              '{"index":0,"verdict":"confirmed|false-positive|needs-context","confidence":0.0,"rationale":"简短中文说明"}。' +
              "confidence 取 0–1。verdict 含义：confirmed=确为风险，false-positive=误报，needs-context=需更多上下文。不得索要更多文件，不得输出 JSON 以外的内容。",
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      return {
        status: "限流",
        summary: "AI 服务触发限流，已保留静态扫描结果。",
      };
    }
    if (!response.ok) {
      return {
        status: "失败",
        summary: `AI 服务请求失败（HTTP ${response.status}），已保留静态扫描结果。`,
      };
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        status: "失败",
        summary: "AI 服务未返回有效审查内容，已保留静态扫描结果。",
      };
    }
    const trimmed = content.trim();
    const findings = parseFindingVerdicts(trimmed, payload.length);
    return {
      status: "已完成",
      summary: trimmed.slice(0, 2_000),
      ...(findings ? { findings } : {}),
    };
  } catch {
    return {
      status: "失败",
      summary: "AI 服务不可用或请求超时，已保留静态扫描结果。",
    };
  } finally {
    clearTimeout(timeout);
  }
}
