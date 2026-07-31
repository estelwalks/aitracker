import type { AiReviewResult, SecurityRisk } from "./scanner.ts";

const MAX_RISKS = 50;
const REQUEST_TIMEOUT_MS = 15_000;

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
  return risks.slice(0, MAX_RISKS).map((risk) => ({
    kind: risk.kind,
    severity: risk.severity,
    message: risk.message,
    excerpt: risk.excerpt.slice(0, 180),
  }));
}

export async function reviewSecurityRisks(
  risks: SecurityRisk[],
  options: ReviewOptions = {},
): Promise<AiReviewResult> {
  const config = options.config ?? readConfig();
  if (!config.endpoint || !config.apiKey || !config.model) {
    return {
      status: "未配置",
      summary: "服务端未完整配置 AI endpoint、API key 和 model，已保留静态扫描结果。",
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
    if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("unsupported protocol");
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
              "你是安全审查助手。仅根据已脱敏的静态扫描命中片段，用中文简洁说明风险是否可信、影响和建议；不得索要更多文件。",
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
    return {
      status: "已完成",
      summary: content.trim().slice(0, 2_000),
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
