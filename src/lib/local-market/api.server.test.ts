import assert from "node:assert/strict";
import test from "node:test";

import {
  countInstalledMarketSkills,
  fetchMarketSkills,
  type MarketInstalledSkillShape,
} from "./api.server.ts";

/** Deterministic snapshot used to verify installedCount without touching disk. */
const emptyLocalSkills: MarketInstalledSkillShape[] = [];

const marketLocalSkills: MarketInstalledSkillShape[] = [
  {
    id: "a",
    installations: [
      { source: { kind: "market" } },
      { source: { kind: "market" } },
    ],
  },
  {
    id: "b",
    installations: [{ source: { kind: "frontmatter" } }],
  },
  {
    id: "c",
    installations: [{ source: { kind: "market" } }, { source: null }],
  },
];

/** Market fetch options that pin installedCount so tests never scan the disk. */
const noScan = (overrides: { installedCount?: number } = {}) => ({
  installedCount: overrides.installedCount ?? 0,
});

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

test("fetchMarketSkills sends pagination, keyword, tags, and sort to the API", async () => {
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试", sort: "stars", tags: ["ai"] },
    {
      ...noScan(),
      fetcher: async (input, init) => {
        // 仅捕获列表请求（POST）；体积预取的 HEAD 不应覆盖记录的列表请求。
        if (init?.method === "POST") {
          requestedUrl = String(input);
          requestedBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
        }
        return new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const url = new URL(requestedUrl);
  assert.equal(url.pathname.endsWith("/skills/search"), true);
  assert.equal(url.searchParams.get("lang"), "zh");
  assert.equal(requestedBody.page, 1);
  assert.equal(requestedBody.limit, 20);
  assert.equal(requestedBody.search, "测试");
  assert.equal(requestedBody.sort_by, "stars");
  assert.deepEqual(requestedBody.tags, ["ai"]);
  assert.equal(result.source, "network");
  assert.equal(result.skills[0]?.name, "market-test-skill");
});

test("fetchMarketSkills computes stats from the response page", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      ...noScan(),
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

test("fetchMarketSkills reports the injected local market install count", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      installedCount: 3,
      fetcher: async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );

  assert.equal(result.stats?.installedCount, 3);
});

test("fetchMarketSkills counts installed market skills from a real local snapshot", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      localSnapshot: { skills: marketLocalSkills },
      fetcher: async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );

  // a + c carry a market-managed installation; b is frontmatter-only.
  assert.equal(result.stats?.installedCount, 2);
});

test("countInstalledMarketSkills returns 0 without local market installs", () => {
  assert.equal(countInstalledMarketSkills(emptyLocalSkills), 0);
  assert.equal(
    countInstalledMarketSkills([
      { id: "x", installations: [{ source: null }] },
    ]),
    0,
  );
});

test("countInstalledMarketSkills counts each market Skill once regardless of copy count", () => {
  assert.equal(countInstalledMarketSkills(marketLocalSkills), 2);
});

test("fetchMarketSkills sorts by downloads descending", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "downloads" },
    {
      ...noScan(),
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
