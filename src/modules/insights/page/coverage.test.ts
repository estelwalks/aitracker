import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INSIGHT_SURFACE_IDS } from "./contracts.ts";
import type { InsightSurfaceId } from "./contracts.ts";

const ROUTES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../routes",
);

const SURFACE_ROUTE_FILES: Record<InsightSurfaceId, string> = {
  dashboard: "index.tsx",
  agents: "agents.tsx",
  distill: "distill.tsx",
  reports: "reports.tsx",
  memory: "memory.tsx",
  security: "security.tsx",
  tracker: "tracker.tsx",
  skills: "skills.tsx",
  market: "market.tsx",
  chats: "chats.index.tsx",
  "chat-detail": "chats.$id.tsx",
  widget: "widget.tsx",
  settings: "settings.tsx",
  sources: "sources.tsx",
};

test("all fourteen surfaces are registered", () => {
  assert.equal(INSIGHT_SURFACE_IDS.length, 14);
  assert.equal(Object.keys(SURFACE_ROUTE_FILES).length, 14);
});

test("every surface maps to an existing route file", () => {
  const files = new Set(readdirSync(ROUTES_DIR));
  for (const surface of INSIGHT_SURFACE_IDS) {
    const file = SURFACE_ROUTE_FILES[surface];
    assert.ok(file, `no route mapping for surface ${surface}`);
    assert.ok(files.has(file), `missing route file ${file} for ${surface}`);
  }
});

test("registered route files match the non-lazy route set exactly", () => {
  const files = readdirSync(ROUTES_DIR)
    .filter(
      (name) =>
        name.endsWith(".tsx") &&
        !name.endsWith(".lazy.tsx") &&
        name !== "__root.tsx" &&
        name !== "sitemap[.]xml.ts",
    )
    .sort();
  const registered = Object.values(SURFACE_ROUTE_FILES).slice().sort();
  assert.deepEqual(files, registered);
});

test("the sitemap file is explicitly excluded from the surface registry", () => {
  const files = readdirSync(ROUTES_DIR);
  assert.ok(files.includes("sitemap[.]xml.ts"), "sitemap file should exist");
  const registered = new Set(Object.values(SURFACE_ROUTE_FILES));
  assert.equal(registered.has("sitemap[.]xml.ts"), false);
});

test("settings page keeps only the insight settings toggle", () => {
  const source = readFileSync(
    path.resolve(
      ROUTES_DIR,
      "../modules/settings/presentation/SettingsPage.tsx",
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /InsightCard/);
  assert.match(source, /<InsightSettingsSection\s*\/>/);
});
