import assert from "node:assert/strict";
import test from "node:test";

import { reviewSecurityRisks } from "./ai-review.server.ts";
import type { SecurityRisk } from "./scanner.ts";

const risk: SecurityRisk = {
  kind: "敏感信息",
  severity: "高危",
  source: "内置规则",
  ruleName: "访问密钥特征",
  file: "secret.ts",
  line: 1,
  message: "发现疑似真实访问密钥",
  excerpt: 'API_KEY="••••••••"',
};

test("does not call external service when configuration is missing", async () => {
  let called = false;
  const result = await reviewSecurityRisks([risk], {
    config: {},
    fetcher: async () => {
      called = true;
      throw new Error("should not run");
    },
  });

  assert.equal(result.status, "未配置");
  assert.equal(called, false);
});

test("sends only minimized masked risk fields", async () => {
  let requestBody = "";
  const result = await reviewSecurityRisks([risk], {
    config: {
      endpoint: "https://example.test/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    },
    fetcher: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "风险可信，建议移除凭据。" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.equal(result.status, "已完成");
  assert.match(result.summary, /风险可信/);
  assert.doesNotMatch(requestBody, /secret\.ts/);
  assert.doesNotMatch(requestBody, /"line":1/);
  assert.match(requestBody, /••••••••/);
});

test("degrades to static result status on rate limiting and request failure", async () => {
  const config = {
    endpoint: "https://example.test/v1/chat/completions",
    apiKey: "test-key",
    model: "test-model",
  };
  const limited = await reviewSecurityRisks([risk], {
    config,
    fetcher: async () => new Response("", { status: 429 }),
  });
  const failed = await reviewSecurityRisks([risk], {
    config,
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(limited.status, "限流");
  assert.equal(failed.status, "失败");
});
