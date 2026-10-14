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

/**
 * The panel-size artwork is a deliberately bolder treatment of the same mark.
 * The 1024px design draws its corner brackets on a 1.25/16 stroke, which
 * rasterizes to a ~1.7px hairline at the 22px a panel renders and reads as a
 * faint outline. This guards the extra ink so a future regeneration cannot
 * quietly return to the hairline.
 */
test("status icons carry more ink than the app-icon mark at panel size", async () => {
  const { Resvg } = await import("@resvg/resvg-js");
  const { linuxTrayArtwork } =
    await import("../scripts/generate-native-icons.mjs");
  const solidIn = (svg, size) => {
    const px = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
    }).render().pixels;
    let solid = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] >= 200) solid += 1;
    return solid;
  };
  for (const [file, colors] of [
    ["favicon.svg", true],
    ["favicon-dark.svg", false],
  ]) {
    const source = readFileSync(join(projectRoot, "public", file), "utf8");
    const size = 22;
    const plain = solidIn(source, size);
    const tray = solidIn(linuxTrayArtwork(source), size);
    assert.ok(
      tray > plain * 1.4,
      `${file}: panel artwork must add ink (app-icon mark ${plain} solid px, status icon ${tray})`,
    );
    // Small-size artwork must stay inside the canvas rather than clip at the edge.
    const px = new Resvg(linuxTrayArtwork(source), {
      fitTo: { mode: "width", value: size },
    }).render().pixels;
    for (let i = 0; i < size; i++) {
      for (const edge of [
        i,
        (size - 1) * size + i,
        i * size,
        i * size + size - 1,
      ]) {
        assert.equal(
          px[edge * 4 + 3],
          0,
          `${file}: artwork must not touch the edge`,
        );
      }
    }
    assert.equal(colors, file === "favicon.svg");
  }
});

/**
 * The hicolor app icon must be the macOS app tile, not a second design.
 *
 * The two platforms used to differ on purpose and the difference was visible
 * side by side: the Linux variant drew its plate edge-to-edge with a heavier
 * mark, which reads as crowded next to the macOS tile's margin. Delegating to
 * macAppArtwork is what keeps them identical, so this asserts the delegation
 * rather than any particular geometry — if the app tile changes, both platforms
 * change together and this still passes, while a re-introduced Linux-only design
 * fails.
 *
 * The status-area artwork is deliberately not covered here: it is a separate
 * 22px panel glyph with its own weights, and macOS uses a template mask there.
 */
test("the hicolor app icon is the macOS app tile", async () => {
  const { macAppArtwork, linuxAppArtwork } =
    await import("../scripts/generate-native-icons.mjs");
  const source = readFileSync(
    join(projectRoot, "public", "favicon.svg"),
    "utf8",
  );
  assert.equal(
    linuxAppArtwork(source),
    macAppArtwork(source),
    "the Linux application icon must reuse the macOS tile",
  );

  // And the files on disk must agree, so a stale tree cannot pass.
  const { Resvg } = await import("@resvg/resvg-js");
  const size = 512;
  const render = (svg) =>
    Buffer.from(
      new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().pixels,
    );
  assert.ok(
    render(linuxAppArtwork(source)).equals(render(macAppArtwork(source))),
    "rendered Linux and macOS tiles must be identical at 512px",
  );

  // The tile is a white rounded plate, so most of the canvas is opaque.
  const px = render(linuxAppArtwork(source));
  let opaque = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque += 1;
  assert.ok(
    opaque > size * size * 0.5,
    `the app tile must be mostly opaque, got ${opaque} of ${size * size}`,
  );
  // Its outer margin stays transparent so it sits like a Dock tile.
  for (let i = 0; i < size; i++) {
    for (const idx of [
      i,
      (size - 1) * size + i,
      i * size,
      i * size + size - 1,
    ]) {
      assert.equal(
        px[idx * 4 + 3],
        0,
        "the tile must not fill the canvas edge",
      );
    }
  }
});
