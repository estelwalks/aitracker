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
      install_count: 100,
      is_official: true,
    },
    {
      id: 2,
      name: "another-skill",
      slug: "another-skill",
      repo_owner: "owner2",
      repo_name: "repo2",
      repo_path: "skills/another-skill/SKILL.md",
      install_count: 50,
      is_official: false,
    },
  ],
  pagination: { page: 1, limit: 20, total: 2, pages: 1 },
};

test("fetchMarketSkills sends pagination, keyword, and sort to the API", async () => {
  let requestedUrl = "";
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试", sort: "downloads" },
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
  assert.equal(url.searchParams.get("sort"), "downloads");
  assert.equal(result.source, "network");
  assert.equal(result.skills[0]?.name, "market-test-skill");
});

test("fetchMarketSkills computes stats from the response page", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      fetcher: async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );

  assert.ok(result.stats);
  assert.equal(result.stats.totalSkills, 2);
  assert.equal(result.stats.officialCount, 1);
  assert.equal(result.stats.totalDownloads, 150);
  assert.equal(result.stats.installedCount, 0);
});

test("fetchMarketSkills sorts by downloads descending", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      fetcher: async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );

  assert.equal(result.skills[0]?.name, "market-test-skill");
  assert.equal(result.skills[1]?.name, "another-skill");
});

test("fetchMarketSkills falls back to the query cache when network fails", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试", sort: "downloads" },
    {
      fetcher: async () => {
        throw new Error("offline");
      },
    },
  );

  assert.equal(result.source, "cache");
  assert.match(result.warning ?? "", /网络不可用/);
});
