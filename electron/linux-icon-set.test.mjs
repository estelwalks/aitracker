import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
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
 * The hicolor app icon must be the macOS app tile, only cropped.
 *
 * Two regressions are possible here and they pull in opposite directions, so
 * both are asserted.
 *
 * The first is a second design. Linux once drew its own tile: plate edge-to-edge
 * with a heavier mark, which read as a different product next to macOS. That is
 * caught by requiring the two to agree on the tile itself - the plate, its
 * radius, its fill and the mark's placement.
 *
 * The second is the icon reading as too small. The macOS artboard carries a
 * margin for the Dock, so the tile fills only 824/1024 = 80.5% of it, and in a
 * GNOME app grid that looks undersized next to neighbours measuring 81-100%
 * (chromium and syncthing fill the whole canvas). The Linux icon therefore crops
 * the canvas to 88% and must stay strictly larger than the macOS one, which is
 * what fails if someone reverts the crop.
 *
 * Only the canvas differs: the artboard is 1024 units on both sides and the
 * geometry inside is untouched, so this is a crop and not a redraw. That is why
 * the shared inner markup is asserted verbatim instead of the whole document.
 *
 * The status-area artwork is deliberately not covered: it is a separate 22px
 * panel glyph with its own weights, and macOS uses a template mask there.
 */
test("the hicolor app icon is the macOS app tile, cropped larger", async () => {
  const { macAppArtwork, linuxAppArtwork } =
    await import("../scripts/generate-native-icons.mjs");
  const source = readFileSync(
    join(projectRoot, "public", "favicon.svg"),
    "utf8",
  );
  const mac = macAppArtwork(source);
  const linux = linuxAppArtwork(source);
  const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/u)?.[1];
  const inner = (svg) => svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/u)?.[1];

  assert.notEqual(linux, mac, "the Linux icon must crop the canvas");
  assert.ok(viewBox(linux), "the Linux icon must declare a viewBox");
  assert.equal(
    inner(linux),
    inner(mac),
    "the tile and mark must be the macOS ones, unchanged",
  );

  const { Resvg } = await import("@resvg/resvg-js");
  const size = 512;
  const render = (svg) =>
    Buffer.from(
      new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().pixels,
    );
  /** Where the painted tile sits, in pixels of a `size` canvas. */
  const coverage = (px) => {
    let minX = size;
    let maxX = -1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (px[(y * size + x) * 4 + 3] < 16) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    assert.ok(maxX >= 0, "the tile must be painted");
    return { width: maxX - minX + 1, left: minX };
  };

  const macBox = coverage(render(mac));
  const linuxBox = coverage(render(linux));
  assert.ok(
    linuxBox.width > macBox.width * 1.05,
    `the Linux tile must be visibly larger than the macOS one (linux ${linuxBox.width}px vs mac ${macBox.width}px at ${size}px)`,
  );
  assert.ok(
    linuxBox.width / size > 0.85 && linuxBox.width / size < 0.95,
    `the Linux tile must sit near 88% of the canvas, got ${((100 * linuxBox.width) / size).toFixed(1)}%`,
  );
  // A crop still leaves a margin, so the tile never bleeds off the edge.
  assert.ok(
    linuxBox.left > 0,
    "the cropped tile must still keep a transparent margin",
  );
});

/**
 * The mark must actually be visible against the plate.
 *
 * This is the assertion that was missing. The app tile has a WHITE plate and the
 * generator is fed two artwork sources - a light-theme one with dark ink and a
 * dark-theme one with light ink - so passing the wrong source painted light ink
 * onto the white plate and shipped an empty white square. Every other assertion
 * in this file passed while the icon was blank, because "the plate is opaque"
 * and "the margins are transparent" are both still true of a blank tile. The
 * check has to be about contrast between the ink and the plate.
 */
test("the app tile's mark contrasts with its plate", async () => {
  const { Resvg } = await import("@resvg/resvg-js");
  const { linuxAppArtwork } =
    await import("../scripts/generate-native-icons.mjs");
  const size = 256;
  const source = readFileSync(
    join(projectRoot, "public", "favicon.svg"),
    "utf8",
  );
  const px = new Resvg(linuxAppArtwork(source), {
    fitTo: { mode: "width", value: size },
  }).render().pixels;

  let darkest = 255;
  let lightest = 0;
  for (let i = 0; i < size * size; i += 1) {
    // Only fully painted pixels: the transparent margin is not part of the tile.
    if (px[i * 4 + 3] < 250) continue;
    const lum =
      0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
    darkest = Math.min(darkest, lum);
    lightest = Math.max(lightest, lum);
  }
  const contrast = (lightest + 5) / (darkest + 5);
  assert.ok(
    contrast > 5,
    `the mark must contrast with its plate: darkest ink ${darkest.toFixed(0)}, plate ${lightest.toFixed(0)}, ratio ${contrast.toFixed(2)}:1`,
  );
});

/**
 * The generated files on disk must show a mark on their plate.
 *
 * This reads the emitted PNG rather than calling the generator, because the bug
 * this guards against lived in the caller: `generateLinuxIcons` was handed the
 * dark-theme artwork source (light ink) while the app tile's plate is white, so
 * the icon shipped as an empty white square. A test that calls
 * `linuxAppArtwork(lightSource)` itself cannot see that mistake — it exercises
 * the function with the argument the caller should have passed, so it stays
 * green while the shipped file is blank.
 *
 * Decoding is deliberately minimal: the generator writes 8-bit RGBA,
 * non-interlaced PNGs, which is all this handles.
 */
function decodeRgbaPng(file) {
  const raw = readFileSync(file);
  if (raw.readUInt32BE(16) !== raw.readUInt32BE(20)) {
    throw new Error(`${file}: expected a square icon`);
  }
  const width = raw.readUInt32BE(16);
  const depth = raw[24];
  const colorType = raw[25];
  const interlace = raw[28];
  if (depth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `${file}: expected 8-bit RGBA non-interlaced, got depth=${depth} colorType=${colorType} interlace=${interlace}`,
    );
  }
  const chunks = [];
  let offset = 8;
  while (offset < raw.length) {
    const length = raw.readUInt32BE(offset);
    if (raw.subarray(offset + 4, offset + 8).toString() === "IDAT") {
      chunks.push(raw.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * width * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < width; y += 1) {
    const filter = inflated[y * (stride + 1)];
    const line = Buffer.from(
      inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] =
          (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, pixels };
}

test("every generated application icon has ink visible on its plate", () => {
  for (const size of [32, 48, 256]) {
    const { width, pixels } = decodeRgbaPng(
      join(iconRoot, linuxIconName(size)),
    );
    let darkest = 255;
    let lightest = 0;
    let painted = 0;
    for (let i = 0; i < width * width; i += 1) {
      if (pixels[i * 4 + 3] < 250) continue;
      painted += 1;
      const lum =
        0.2126 * pixels[i * 4] +
        0.7152 * pixels[i * 4 + 1] +
        0.0722 * pixels[i * 4 + 2];
      darkest = Math.min(darkest, lum);
      lightest = Math.max(lightest, lum);
    }
    assert.ok(painted > 0, `${size}px: the tile must be painted`);
    const contrast = (lightest + 5) / (darkest + 5);
    assert.ok(
      contrast > 4,
      `${size}px: the mark must contrast with its plate (ink ${darkest.toFixed(0)} on plate ${lightest.toFixed(0)}, ${contrast.toFixed(2)}:1) — a blank tile means the wrong artwork source reached the generator`,
    );
  }
});
