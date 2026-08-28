import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const componentSource = readFileSync(
  resolve(root, "src/components/aitracker.tsx"),
  "utf8",
);

function moduleTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return moduleTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("shared pagination anchors page controls on the right", () => {
  const rangeIndex = componentSource.indexOf("{rangeLabel ?");
  const controlsIndex = componentSource.indexOf(
    'className="aitracker-pagination-controls ml-auto',
  );

  assert.ok(rangeIndex >= 0);
  assert.ok(controlsIndex > rangeIndex);
  assert.match(componentSource, /paginationWindow\(current, safePageCount\)/);
  assert.match(componentSource, /min-w-\[var\(--aitracker-control-height\)\]/);
});

test("every module page uses the shared pagination component", () => {
  const consumers = moduleTsxFiles(resolve(root, "src/modules"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => source.includes("<Pagination"));

  assert.ok(consumers.length > 0);
  for (const consumer of consumers) {
    assert.match(
      consumer.source,
      /from ["'][^"']*components\/aitracker(?:\.tsx)?["']/,
      `${consumer.path} must use the shared Pagination export`,
    );
    assert.doesNotMatch(consumer.source, /components\/ui\/pagination/);
  }
});

test("market, Skill management, and security lists share ten rows per page", () => {
  const standard = readFileSync(resolve(root, "src/lib/pagination.ts"), "utf8");
  assert.match(standard, /STANDARD_PAGE_SIZE = 10/);

  for (const relativePath of [
    "src/routes/market.tsx",
    "src/modules/skill-distribution/presentation/MarketPanel.tsx",
    "src/modules/skill-catalog/presentation/SkillsPage.tsx",
    "src/modules/security-assessment/presentation/components/UnsafeSkillList.tsx",
  ]) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    assert.match(
      source,
      /STANDARD_PAGE_SIZE/,
      `${relativePath} must use the standard ten-row page size`,
    );
  }
});
