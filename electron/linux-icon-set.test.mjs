import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LINUX_ICON_SIZES,
  LINUX_TRAY_ICON_SIZES,
  linuxIconName,
  linuxTrayIconName,
} from "../scripts/generate-native-icons.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const iconRoot = join(projectRoot, "build", "native-icons");

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * electron-builder installs this directory as the freedesktop hicolor set and
 * reads each icon's size from its file name, so the names and the pixel
 * dimensions have to agree — a mismatch installs a wrongly-sized icon rather
 * than failing the build.
 */
test("the Linux hicolor set covers the standard sizes up to 512", () => {
  assert.deepEqual(LINUX_ICON_SIZES, [16, 24, 32, 48, 64, 128, 256, 512]);
  for (const size of LINUX_ICON_SIZES) {
    const name = linuxIconName(size);
    assert.equal(name, `linux/${size}x${size}.png`);
    const buffer = readFileSync(join(iconRoot, name));
    assert.deepEqual(pngSize(buffer), { width: size, height: size }, name);
  }
});

test("no Linux icon exceeds the hicolor maximum of 512", () => {
  // 1024 is not a hicolor directory; electron-builder would install it under a
  // non-standard `hicolor/1024x1024/` that no theme ever looks at.
  for (const size of LINUX_ICON_SIZES) {
    assert.ok(size <= 512, `${size} is not a hicolor size`);
  }
});

test("the Linux status icons exist at panel size and 2× for each appearance", () => {
  assert.deepEqual(LINUX_TRAY_ICON_SIZES, [22, 24, 44, 48]);
  for (const appearance of ["light", "dark"]) {
    for (const size of LINUX_TRAY_ICON_SIZES) {
      const name = linuxTrayIconName(appearance, size);
      assert.equal(name, `linux/tray-${appearance}-${size}.png`);
      const buffer = readFileSync(join(iconRoot, name));
      assert.deepEqual(pngSize(buffer), { width: size, height: size }, name);
    }
  }
});

test("the generated manifest records both Linux size sets", () => {
  const manifest = JSON.parse(
    readFileSync(join(iconRoot, "manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.linuxSizes, LINUX_ICON_SIZES);
  assert.deepEqual(manifest.linuxTraySizes, LINUX_TRAY_ICON_SIZES);
});
