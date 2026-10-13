import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
  new URL("./WidgetConfigPanel.tsx", import.meta.url),
  "utf8",
);
const trayTitleSource = readFileSync(
  new URL("./NativeTrayTitleSync.tsx", import.meta.url),
  "utf8",
);

test("状态栏配置区只在 macOS 渲染", () => {
  // `Tray.setTitle` is @platform darwin. On Windows and Linux every control in
  // the "bar" section writes a value the main process discards, so the section
  // must not be rendered at all.
  assert.match(
    panelSource,
    /const visibleSections = sections\.filter\(\s*\(section\) => section !== "bar" \|\| isMac,?\s*\)/,
  );
  assert.match(panelSource, /const \{ isMac \} = usePlatform\(\)/);
  // No render branch may still read the unfiltered list.
  assert.doesNotMatch(panelSource, /sections\.includes\(/);
  for (const section of ["bar", "panel", "desktop"]) {
    assert.match(
      panelSource,
      new RegExp(`visibleSections\\.includes\\("${section}"\\)`),
    );
  }
  // Asking only for the status-area section renders nothing off macOS.
  assert.match(
    panelSource,
    /if \(visibleSections\.length === 0\) return null;/,
  );
});

test("动态栏轮询与标题同步只在 macOS 运行", () => {
  // Before the gate this component ran two queries every 60 seconds on every
  // platform and pushed a title that only macOS can display.
  assert.match(trayTitleSource, /const \{ isMac \} = usePlatform\(\)/);
  assert.match(
    trayTitleSource,
    /const desktopAvailable =\s*isMac && typeof window !== "undefined" && window\.desktopApi != null/,
  );
});
