import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV, MARKET_API_BASE } from "../app-config";
import { resetCompositionRootForTests } from "../../app/composition.server.ts";
import {
  countInstalledMarketSkills,
  fetchMarketSkills,
  type MarketInstalledSkillShape,
} from "./api.server.ts";

/**
 * The market query cache is SQLite-backed through the composition root. Point
 * the composition root at a fresh temp data root for this file so the tests
 * never touch the real `~/.aitracker` database (which a running dev/Electron
 * process may hold open, and whose migration ledger can carry an older
 * checksum than the code under test).
 */
let previousHome: string | undefined;
let tempDir: string | undefined;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "aitracker-market-"));
  previousHome = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = tempDir;
  resetCompositionRootForTests();
});

after(async () => {
  resetCompositionRootForTests();
  if (previousHome === undefined) delete process.env[ENV.USAGE_HOME];
  else process.env[ENV.USAGE_HOME] = previousHome;
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

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
  skipFreshCache: true,
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
      description: "Market test skill",
      short_description: "Short market test skill",
      security_score: 95,
      security_level: "low",
      stars: 120,
      tags: ["security"],
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    {
      id: 2,
      name: "another-skill",
      slug: "another-skill",
      repo_owner: "owner2",
      repo_name: "repo2",
      repo_path: "skills/another-skill/SKILL.md",
      description: "Another skill",
      short_description: "Short another skill",
      security_score: 60,
      security_level: "medium",
      stars: 80,
      tags: ["dev"],
      updated_at: "2026-07-01T00:00:00.000Z",
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
  const expectedLegacyHost = ["ai", ["trust", "tools"].join(""), "cn"].join(
    ".",
  );
  assert.equal(MARKET_API_BASE, `https://${expectedLegacyHost}/api`);
  assert.equal(url.origin, `https://${expectedLegacyHost}`);
  assert.equal(url.pathname, "/api/external-api/v1/skills/search");
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
    { page: 1, limit: 20, search: "", sort: "stars" },
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
  assert.equal(result.stats.installedCount, 0);
});

test("fetchMarketSkills reports the injected local market install count", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "stars" },
    {
      installedCount: 3,
      skipFreshCache: true,
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
    { page: 1, limit: 20, search: "", sort: "stars" },
    {
      localSnapshot: { skills: marketLocalSkills },
      skipFreshCache: true,
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

test("fetchMarketSkills sorts by security score descending", async () => {
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "security_score" },
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
  assert.equal(result.skills[0]?.securityScore, 95);
  assert.equal(result.skills[1]?.name, "another-skill");
  assert.equal(result.skills[1]?.securityScore, 60);
});

test("fetchMarketSkills forwards sort_by and omits legacy body fields", async () => {
  let requestedBody: Record<string, unknown> = {};
  const result = await fetchMarketSkills(
    { page: 1, limit: 20, search: "", sort: "security_score" },
    {
      ...noScan(),
      fetcher: async (input, init) => {
        if (init?.method === "POST") {
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

  // 外接 API v1 的 sort_by 枚举透传；mode/status/safety_level/language/deduplicate
  // 等旧参数不再下发。
  assert.equal(requestedBody.sort_by, "security_score");
  assert.equal("mode" in requestedBody, false);
  assert.equal("status" in requestedBody, false);
  assert.equal("safety_level" in requestedBody, false);
  assert.equal("language" in requestedBody, false);
  assert.equal("deduplicate" in requestedBody, false);
  assert.equal(result.skills[0]?.name, "market-test-skill");
  assert.equal(result.skills[0]?.securityScore, 95);
});

test("fetchMarketSkills falls back to the query cache when network fails", async () => {
  // 先以同一查询成功请求一次，写入缓存，使回退断言不依赖外部缓存状态。
  await fetchMarketSkills(
    { page: 1, limit: 20, search: "测试", sort: "stars" },
    {
      ...noScan(),
      fetcher: async () =>
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );

  const result = await fetchMarketSkills(
    {
      page: 1,
      limit: 20,
      search: "测试",
      sort: "stars",
      forceRefresh: true,
    },
    {
      fetcher: async () => {
        throw new Error("offline");
      },
    },
  );

  assert.equal(result.source, "cache");
  assert.match(result.warning ?? "", /网络不可用/);
});

test("fresh query cache avoids both list and size network requests", async () => {
  const query = {
    page: 1,
    limit: 20,
    search: `ttl-fresh-${process.pid}`,
    sort: "stars" as const,
  };
  const now = Date.parse("2026-08-19T00:00:00.000Z");
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify(validResponse), { status: 200 });
  };
  await fetchMarketSkills(query, {
    ...noScan(),
    fetcher,
    now: () => new Date(now),
  });
  requests = 0;

  const cached = await fetchMarketSkills(query, {
    ...noScan(),
    skipFreshCache: false,
    fetcher,
    now: () => new Date(now + 29 * 60_000),
  });
  assert.equal(requests, 0);
  assert.equal(cached.source, "cache");
  assert.equal(cached.warning, null);
});

test("stale query cache refreshes from the network", async () => {
  const query = {
    page: 1,
    limit: 20,
    search: `ttl-stale-${process.pid}`,
    sort: "stars" as const,
  };
  const now = Date.parse("2026-08-19T00:00:00.000Z");
  await fetchMarketSkills(query, {
    ...noScan(),
    fetcher: async () =>
      new Response(JSON.stringify(validResponse), { status: 200 }),
    now: () => new Date(now),
  });
  let posts = 0;
  const refreshed = await fetchMarketSkills(query, {
    ...noScan(),
    skipFreshCache: false,
    fetcher: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify(validResponse), { status: 200 });
    },
    now: () => new Date(now + 31 * 60_000),
  });
  assert.equal(posts, 1);
  assert.equal(refreshed.source, "network");
});

test("forceRefresh bypasses a fresh query cache", async () => {
  const base = {
    page: 1,
    limit: 20,
    search: `ttl-force-${process.pid}`,
    sort: "stars" as const,
  };
  const now = new Date("2026-08-19T00:00:00.000Z");
  await fetchMarketSkills(base, {
    ...noScan(),
    fetcher: async () =>
      new Response(JSON.stringify(validResponse), { status: 200 }),
    now: () => now,
  });
  let posts = 0;
  await fetchMarketSkills(
    { ...base, forceRefresh: true },
    {
      ...noScan(),
      skipFreshCache: false,
      fetcher: async (_input, init) => {
        if (init?.method === "POST") posts += 1;
        return new Response(JSON.stringify(validResponse), { status: 200 });
      },
      now: () => now,
    },
  );
  assert.equal(posts, 1);
});
