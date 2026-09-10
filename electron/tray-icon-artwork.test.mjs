import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Resvg } from "@resvg/resvg-js";
import {
  compactArtwork,
  macAppArtwork,
  packIco,
  renderPng,
  WINDOWS_ICON_SIZES,
} from "../scripts/generate-native-icons.mjs";

const light = readFileSync(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);
const dark = readFileSync(
  new URL("../public/favicon-dark.svg", import.meta.url),
  "utf8",
);

function raster(svg, size) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  }).render().pixels;
}

function alphaAt(pixels, size, x, y) {
  return pixels[
    (Math.floor((y * size) / 16) * size + Math.floor((x * size) / 16)) * 4 + 3
  ];
}

test("all three light trails remain visible in small native icons at every DPI", () => {
  const template = compactArtwork(light, { template: true });
  for (const size of [16, 20, 24, 32, 40, 48, 64]) {
    const pixels = raster(template, size);
    // These sample the body of each trail, below its point and away from the
    // frame. The earlier glyph-only export left all three areas transparent.
    for (const [x, y] of [
      [3.7, 10.8],
      [6, 10.25],
      [8.75, 9.5],
    ]) {
      const alpha = alphaAt(pixels, size, x, y);
      assert.ok(
        alpha >= 56 && alpha < 230,
        `${size}px trail must remain visible and translucent`,
      );
    }
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(
        pixels[i] + pixels[i + 1] + pixels[i + 2],
        0,
        "AppKit template must contain black ink only",
      );
    }
    for (let i = 0; i < size; i++) {
      for (const edge of [
        i,
        (size - 1) * size + i,
        i * size,
        i * size + size - 1,
      ]) {
        assert.equal(
          pixels[edge * 4 + 3],
          0,
          "canvas must retain transparent margins",
        );
      }
    }
  }
});

test("shared web/Windows artwork stays transparent without a macOS backplate", () => {
  for (const source of [light, dark]) {
    const pixels = raster(source, 64);
    const nativePixels = raster(compactArtwork(source), 64);
    // The two viewBox scales can round a gradient channel by one byte.
    assert.ok(
      pixels.every(
        (value, index) => Math.abs(value - nativePixels[index]) <= 1,
      ),
    );
    for (const [x, y] of [
      [8, 3],
      [11, 11],
      [8, 0.5],
    ]) {
      assert.equal(
        alphaAt(pixels, 64, x, y),
        0,
        "space around and inside the mark must be transparent",
      );
    }
  }
});

test("macOS app artwork has white space inside the mark and transparent outer corners", () => {
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const pixels = raster(macAppArtwork(light), size);
    for (const [x, y] of [
      [6, 6],
      [10, 10],
      [8, 2],
    ]) {
      const offset =
        (Math.floor((y * size) / 16) * size + Math.floor((x * size) / 16)) * 4;
      assert.deepEqual(
        [...pixels.subarray(offset, offset + 4)],
        [255, 255, 255, 255],
        `${size}px macOS tile must be opaque white around and inside the mark`,
      );
    }
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
    ]) {
      assert.equal(alphaAt(pixels, size, x, y), 0);
    }
    assert.ok(
      pixels.some(
        (value, index) =>
          index % 4 === 0 && value < 64 && pixels[index + 3] === 255,
      ),
      `${size}px tile must retain visible dark artwork`,
    );
  }
});

test("light/dark appearances share the exact same optical master", () => {
  assert.equal(
    compactArtwork(light, { template: true }),
    compactArtwork(dark, { template: true }),
  );
  assert.throws(() => compactArtwork('<svg color="#000000"/>'), /native-mark/u);
});

test("menu-bar PNGs carry 16px at 72dpi and 32px at 144dpi", () => {
  for (const scale of [1, 2]) {
    const png = renderPng(
      compactArtwork(light, { template: true }),
      16 * scale,
      72 * scale,
    );
    assert.equal(png.readUInt32BE(16), 16 * scale);
    assert.equal(png.readUInt32BE(20), 16 * scale);
    const density = png.indexOf(Buffer.from("pHYs"));
    assert.ok(density > 0);
    assert.equal(
      png.readUInt32BE(density + 4),
      Math.round((72 * scale) / 0.0254),
    );
    assert.equal(png[density + 12], 1);
  }
});

test("Windows ICO contains independently decodable frames including 125% and 150%", () => {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  assert.deepEqual(WINDOWS_ICON_SIZES, sizes);
  const ico = packIco(
    sizes.map((size) => ({
      size,
      png: renderPng(compactArtwork(light), size),
    })),
  );
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    const offset = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    assert.ok(offset + length <= ico.length);
    const png = ico.subarray(offset, offset + length);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
