import assert from "node:assert/strict";
import test from "node:test";

import type { LocalSkill } from "../../skill-catalog/query/contracts.ts";
import {
  buildMarketInstallIndex,
  marketInstalledAgents,
  type MarketSkillIdentity,
} from "./market-install-status.ts";

function localSkill(
  name: string,
  installations: readonly {
    readonly agent: string;
    readonly directoryName?: string;
    readonly source: {
      readonly kind: "frontmatter" | "market";
      readonly label: string;
    } | null;
  }[],
): LocalSkill {
  return {
    id: name,
    name,
    description: null,
    form: "package",
    lastUsedAt: null,
    sizeBytes: 0,
    tokenEstimate: 0,
    installations: installations.map((installation, index) => ({
      installationRef: `installation:${name}:${index}`,
      agent: installation.agent as LocalSkill["installations"][number]["agent"],
      installedAt: "2026-10-19T00:00:00.000Z",
      modifiedAt: "2026-10-19T00:00:00.000Z",
      version: null,
      source: installation.source,
      updateStatus: "unknown",
      updateReason: "test",
      ...(installation.directoryName
        ? { directoryName: installation.directoryName }
        : {}),
    })),
  };
}

function marketSkill(
  overrides: Partial<MarketSkillIdentity> = {},
): MarketSkillIdentity {
  return {
    name: "github",
    repoOwner: "openclaw",
    repoName: "openclaw",
    installDirectory: "github",
    ...overrides,
  };
}

test("one install does not mark every sibling Skill of the repository", () => {
  const index = buildMarketInstallIndex([
    localSkill("github", [
      {
        agent: "Claude Code",
        directoryName: "github",
        source: { kind: "market", label: "openclaw/openclaw" },
      },
    ]),
  ]);

  assert.deepEqual(marketInstalledAgents(index, marketSkill()), {
    "Claude Code": true,
  });
  assert.deepEqual(
    marketInstalledAgents(
      index,
      marketSkill({ name: "gh-issues", installDirectory: "gh-issues" }),
    ),
    {},
  );
  // A same-named Skill from another repository is a different asset.
  assert.deepEqual(
    marketInstalledAgents(
      index,
      marketSkill({ repoOwner: "someone-else", repoName: "other-repo" }),
    ),
    {},
  );
});

test("the installed folder disambiguates catalog entries whose slug differs", () => {
  const index = buildMarketInstallIndex([
    localSkill("antd-create-pr", [
      {
        agent: "Claude Code",
        directoryName: "create-pr",
        source: { kind: "market", label: "ant-design/ant-design" },
      },
    ]),
  ]);

  assert.deepEqual(
    marketInstalledAgents(
      index,
      marketSkill({
        name: "antd-create-pr",
        repoOwner: "ant-design",
        repoName: "ant-design",
        installDirectory: "create-pr",
      }),
    ),
    { "Claude Code": true },
  );
});

test("the SKILL.md name is only a same-repository fallback", () => {
  const index = buildMarketInstallIndex([
    // Legacy shape: the installed folder name was not persisted.
    localSkill("github", [
      {
        agent: "Codex",
        source: { kind: "market", label: "openclaw/openclaw" },
      },
    ]),
  ]);

  assert.deepEqual(marketInstalledAgents(index, marketSkill()), {
    Codex: true,
  });
  // The name must not cross repository boundaries.
  assert.deepEqual(
    marketInstalledAgents(
      index,
      marketSkill({ repoOwner: "other", repoName: "other" }),
    ),
    {},
  );
});

test("local, non-market installations never claim a market row", () => {
  const index = buildMarketInstallIndex([
    localSkill("github", [
      { agent: "Claude Code", directoryName: "github", source: null },
      {
        agent: "Codex",
        directoryName: "github",
        source: { kind: "frontmatter", label: "github.com/me/github" },
      },
    ]),
  ]);

  assert.deepEqual(marketInstalledAgents(index, marketSkill()), {});
});

test("installs for several agents on the same market Skill merge", () => {
  const index = buildMarketInstallIndex([
    localSkill("github", [
      {
        agent: "Claude Code",
        directoryName: "github",
        source: { kind: "market", label: "openclaw/openclaw" },
      },
      {
        agent: "Codex",
        directoryName: "github",
        source: { kind: "market", label: "openclaw/openclaw" },
      },
    ]),
  ]);

  assert.deepEqual(marketInstalledAgents(index, marketSkill()), {
    "Claude Code": true,
    Codex: true,
  });
});
