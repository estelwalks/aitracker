import assert from "node:assert/strict";
import test from "node:test";

import { parseMarketApiResponse, parseMarketQuery } from "./schema.ts";

test("parseMarketApiResponse maps real API fields without inventing rating or version", () => {
  const parsed = parseMarketApiResponse({
    success: true,
    data: [
      {
        id: 7,
        name: "safe-skill",
        slug: "safe-skill",
        repo_owner: "owner",
        repo_name: "repo",
        repo_path: "skills/safe-skill/SKILL.md",
        description: "Description",
        description_zh: "描述",
        install_count: 42,
        security_score: 98,
        security_level: "LOW",
        verdict: "allow",
        tags: ["testing"],
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  });

  assert.equal(parsed.skills[0]?.descriptionZh, "描述");
  assert.equal(parsed.skills[0]?.installCount, 42);
  assert.equal(parsed.skills[0]?.rating, null);
  assert.equal(parsed.skills[0]?.version, null);
  assert.deepEqual(parsed.pagination, {
    page: 1,
    limit: 20,
    total: 1,
    pages: 1,
  });
});

test("parseMarketApiResponse rejects malformed contracts", () => {
  assert.throws(
    () => parseMarketApiResponse({ success: true, data: [{}], pagination: {} }),
    /字段/,
  );
  assert.throws(
    () => parseMarketApiResponse({ success: false, data: [], pagination: {} }),
    /格式无效/,
  );
});

test("parseMarketQuery enforces pagination and search bounds", () => {
  assert.deepEqual(
    parseMarketQuery({ page: 2, limit: 20, search: "  测试  " }),
    {
      page: 2,
      limit: 20,
      search: "测试",
    },
  );
  assert.throws(
    () => parseMarketQuery({ page: 0, limit: 20, search: "" }),
    /页码/,
  );
  assert.throws(
    () => parseMarketQuery({ page: 1, limit: 100, search: "" }),
    /每页/,
  );
});
