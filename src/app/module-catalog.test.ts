import assert from "node:assert/strict";
import test from "node:test";

import {
  moduleCatalogIsSafe,
  PUBLIC_MODULE_CATALOG,
  type PublicModuleCatalog,
} from "./module-catalog.generated.ts";

test("public module catalog contains only unique browser navigation entries", () => {
  const ids = PUBLIC_MODULE_CATALOG.modules.map((module) => module.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every((module) =>
      module.navigation.route.startsWith("/"),
    ),
  );
  assert.ok(moduleCatalogIsSafe(PUBLIC_MODULE_CATALOG));
});

test("module catalog safety rejects operational configuration", () => {
  const unsafeCatalog: PublicModuleCatalog = {
    ...PUBLIC_MODULE_CATALOG,
    modules: [
      ...PUBLIC_MODULE_CATALOG.modules,
      {
        id: "unsafe",
        navigation: { group: "core", route: "/unsafe" },
        i18n: { labelKey: "nav.unsafe" },
        capabilities: ["read-token"],
      },
    ],
  };

  assert.equal(moduleCatalogIsSafe(unsafeCatalog), false);
});
