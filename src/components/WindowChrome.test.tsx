import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { WindowChrome } from "./WindowChrome";

test("SSR and the first client render use the same empty chrome markup", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { desktopApi: {} },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" },
    });

    // Effects do not run during SSR or hydration's first render. Browser
    // globals being present therefore cannot change the initial DOM anymore.
    assert.equal(renderToString(createElement(WindowChrome)), "");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
});
