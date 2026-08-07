import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  moduleCatalogIsSafe,
  PUBLIC_MODULE_CATALOG,
  type PublicModuleCatalog,
} from "./module-catalog.generated.ts";
import {
  ModuleCatalogSchema,
  assertSafeModuleCatalog,
} from "./module-catalog.contracts.ts";

test("catalog covers the three navigation groups in deterministic order", () => {
  const groups = new Set(
    PUBLIC_MODULE_CATALOG.modules.map((module) => module.navigation.group),
  );
  assert.deepEqual(groups, new Set(["core", "protection", "infrastructure"]));
  const orders = PUBLIC_MODULE_CATALOG.modules.map(
    (module) => module.navigation.order,
  );
  assert.deepEqual(
    orders,
    [...orders].sort((left, right) => left - right),
  );
  assert.equal(
    new Set(PUBLIC_MODULE_CATALOG.modules.map((module) => module.id)).size,
    PUBLIC_MODULE_CATALOG.modules.length,
  );
  assert.equal(
    new Set(PUBLIC_MODULE_CATALOG.modules.map((module) => module.i18n.labelKey))
      .size,
    PUBLIC_MODULE_CATALOG.modules.length,
  );
  assert.equal(
    new Set(
      PUBLIC_MODULE_CATALOG.modules.map((module) => module.navigation.route),
    ).size,
    PUBLIC_MODULE_CATALOG.modules.length,
  );
});

test("catalog maps prototype workbench modules and keeps Linux visible as planned", () => {
  const ids = new Set(PUBLIC_MODULE_CATALOG.modules.map((module) => module.id));
  for (const id of [
    "agent-directory",
    "distillation",
    "reports",
    "security-assessment",
    "security-monitor",
    "tracker",
    "skill-catalog",
    "skill-distribution",
    "settings",
  ])
    assert.ok(ids.has(id), `missing ${id}`);
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every(
      (module) => module.platforms.linux === "planned",
    ),
  );
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every(
      (module) => module.platforms.macos === "supported",
    ),
  );
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every(
      (module) => module.platforms.windows10 === "supported",
    ),
  );
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every(
      (module) => module.platforms.windows11 === "supported",
    ),
  );
});

test("generated projection is synchronized with the JSON source", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("./module-catalog.source.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(source, PUBLIC_MODULE_CATALOG);
  assert.deepEqual(ModuleCatalogSchema.parse(source), PUBLIC_MODULE_CATALOG);
});

test("public catalog rejects operational and sensitive fields", () => {
  assert.ok(moduleCatalogIsSafe(PUBLIC_MODULE_CATALOG));
  const unsafe = {
    ...PUBLIC_MODULE_CATALOG,
    modules: [
      ...PUBLIC_MODULE_CATALOG.modules,
      {
        id: "unsafe",
        navigation: { group: "core", route: "/unsafe", order: 999 },
        i18n: { labelKey: "module.unsafe" },
        capabilities: ["read-dashboard"],
        platforms: {
          macos: "supported",
          windows10: "supported",
          windows11: "supported",
          linux: "planned",
        },
        token: "should-never-ship",
      },
    ],
  } as unknown as PublicModuleCatalog;
  assert.equal(moduleCatalogIsSafe(unsafe), false);
  assert.throws(
    () => assertSafeModuleCatalog(unsafe),
    /forbidden module catalog field/,
  );
});
