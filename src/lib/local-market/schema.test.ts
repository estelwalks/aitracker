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
        short_description: "Short description",
        security_score: 98,
        security_level: "low",
        stars: 210,
        tags: ["testing"],
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  });

  assert.equal(parsed.skills[0]?.shortDescription, "Short description");
  assert.equal(parsed.skills[0]?.securityScore, 98);
  assert.equal(parsed.skills[0]?.securityLevel, "low");
  assert.equal(parsed.skills[0]?.stars, 210);
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
    /errors\.market\.(pagingField|field)Invalid/,
  );
  assert.throws(
    () => parseMarketApiResponse({ success: false, data: [], pagination: {} }),
    /errors\.market\.invalidFormat/,
  );
});

test("parseMarketApiResponse ignores legacy stats fields and defaults size to null", () => {
  const parsed = parseMarketApiResponse({
    success: true,
    data: [
      {
        id: 9,
        name: "t",
        slug: "t",
        repo_owner: "o",
        repo_name: "r",
        repo_path: "p",
        description: "D",
        // External API v1 no longer returns inaccurate statistical fields such as installation number/token estimate/official mark.
        install_count: 999,
        token_estimate: { total_tokens: 414 },
        is_official: true,
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  });

  assert.equal(parsed.skills[0]?.size, null);
  assert.equal(parsed.skills[0]?.securityScore, null);
  assert.equal(parsed.skills[0]?.stars, null);
  assert.equal(parsed.skills[0]?.shortDescription, null);
});

test("parseMarketQuery enforces pagination, search bounds, and sort", () => {
  assert.deepEqual(
    parseMarketQuery({ page: 2, limit: 20, search: "  测试  " }),
    {
      page: 2,
      limit: 20,
      search: "测试",
      sort: "stars",
      tags: [],
      forceRefresh: false,
    },
  );
  assert.deepEqual(
    parseMarketQuery({ page: 1, limit: 14, search: "", sort: "created_at" }),
    {
      page: 1,
      limit: 14,
      search: "",
      sort: "created_at",
      tags: [],
      forceRefresh: false,
    },
  );
  assert.deepEqual(
    parseMarketQuery({
      page: 1,
      limit: 14,
      search: "",
      sort: "security_score",
    }),
    {
      page: 1,
      limit: 14,
      search: "",
      sort: "security_score",
      tags: [],
      forceRefresh: false,
    },
  );
  assert.deepEqual(
    parseMarketQuery({
      page: 1,
      limit: 20,
      search: "",
      tags: ["ai", "automation"],
    }),
    {
      page: 1,
      limit: 20,
      search: "",
      sort: "stars",
      tags: ["ai", "automation"],
      forceRefresh: false,
    },
  );
  assert.throws(
    () => parseMarketQuery({ page: 0, limit: 20, search: "" }),
    /errors\.market\.pageNotPositive/,
  );
  assert.throws(
    () => parseMarketQuery({ page: 1, limit: 100, search: "" }),
    /errors\.market\.limitRange/,
  );
  assert.throws(
    () => parseMarketQuery({ page: 1, limit: 20, search: "", sort: "invalid" }),
    /errors\.market\.sortInvalid/,
  );
  assert.throws(
    () =>
      parseMarketQuery({
        page: 1,
        limit: 20,
        search: "",
        forceRefresh: "yes",
      }),
    /errors\.market\.queryInvalid/,
  );
});
