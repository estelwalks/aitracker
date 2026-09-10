import assert from "node:assert/strict";
import test from "node:test";

import { DESKTOP_SECURITY_SCANNER_GLOBAL_KEY as SRC_KEY } from "../src/modules/security-assessment/overview.server.ts";
import {
  DESKTOP_SECURITY_SCANNER_GLOBAL_KEY,
  registerDesktopSecurityScanner,
} from "./desktop-scanner-seam.ts";

test("scanner global key mirrors the server overview resolver", () => {
  assert.equal(
    DESKTOP_SECURITY_SCANNER_GLOBAL_KEY,
    SRC_KEY,
    "Electron main and the same-process SSR bundle must agree on the slot",
  );
});

test("registerDesktopSecurityScanner exposes the handle on the slot", () => {
  const previous = (globalThis as Record<string, unknown>)[
    DESKTOP_SECURITY_SCANNER_GLOBAL_KEY
  ];
  const handle = {
    listSkills: async () => [],
    history: async () => [],
  };
  try {
    registerDesktopSecurityScanner(handle);
    assert.equal(
      (globalThis as Record<string, unknown>)[
        DESKTOP_SECURITY_SCANNER_GLOBAL_KEY
      ],
      handle,
    );
  } finally {
    if (previous === undefined) {
      delete (globalThis as Record<string, unknown>)[
        DESKTOP_SECURITY_SCANNER_GLOBAL_KEY
      ];
    } else {
      (globalThis as Record<string, unknown>)[
        DESKTOP_SECURITY_SCANNER_GLOBAL_KEY
      ] = previous;
    }
  }
});
