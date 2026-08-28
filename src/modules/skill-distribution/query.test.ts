import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market panel (/market) consumes opaque package refs only", () => {
  const source = readFileSync(
    new URL("./presentation/MarketPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /repoPath|repo_path/);
  assert.match(source, /packageRef/);
});

test("market KPI reports every listed Skill as security-passed", () => {
  const source = readFileSync(
    new URL("./presentation/MarketPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const totalSkillCount = result\.stats\?\.totalSkills \?\? 0/,
  );
  assert.equal(
    source.match(/value: format\.formatNumber\(totalSkillCount\)/g)?.length,
    2,
  );
  assert.match(source, /market\.stats\.hintAllDimensionsPassed/);
  assert.doesNotMatch(source, /pageSafeCount|hintCurrentPage/);
});

test("market installed KPI is derived from the live local Skill snapshot", () => {
  const source = readFileSync(
    new URL("./presentation/MarketPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /countInstalledMarketSkills\(localSnapshot\.skills\)/);
  assert.match(
    source,
    /value: format\.formatNumber\(installedMarketSkillCount\)/,
  );
  assert.doesNotMatch(
    source,
    /value: format\.formatNumber\(result\.stats\?\.installedCount \?\? 0\)/,
  );
});
