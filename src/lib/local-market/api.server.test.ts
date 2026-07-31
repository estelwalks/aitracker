import assert from "node:assert/strict";
import test from "node:test";

import { fetchMarketSkills } from "./api.server.ts";

const validResponse = {
  success: true,
  data: [
    {
      id: 1,
      name: "market-test-skill",
      slug: "market-test-skill",
      repo_owner: "owner",
      repo_name: "repo",
      repo_path: "skills/market-test-skill/SKILL.md",
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
};

test("fetchMarketSkills sends pagination and keyword to the API", async () => {
  let requestedUrl = "";
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试" },
    {
      fetcher: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("search"), "测试");
  assert.equal(result.source, "network");
  assert.equal(result.skills[0]?.name, "market-test-skill");
});

test("fetchMarketSkills falls back to the query cache when network fails", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试" },
    {
      fetcher: async () => {
        throw new Error("offline");
      },
    },
  );

  assert.equal(result.source, "cache");
  assert.match(result.warning ?? "", /网络不可用/);
});
