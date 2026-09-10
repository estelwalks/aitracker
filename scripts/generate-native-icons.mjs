import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";

import { Resvg } from "@resvg/resvg-js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = join(projectRoot, "build");
const outputDirectory = join(buildRoot, "native-icons");
const sources = {
  light: join(projectRoot, "public", "favicon.svg"),
  dark: join(projectRoot, "public", "favicon-dark.svg"),
};

// Include the intermediate Windows DPI sizes; a 16px-only PNG is upscaled at
// 125/150/200%. Each frame is rasterized directly at its final size.
export const WINDOWS_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const ICNS_ENTRIES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 512],
  ["ic14", 1024],
];
const outputNames = [
  "trayTemplate.png",
  "trayTemplate@2x.png",
  "icon.ico",
  "mac-app.icns",
  "mac-app-512.png",
  "mac-app-1024.png",
  ...Object.keys(sources).flatMap((appearance) => [
    `favicon-${appearance}.png`,
    `favicon-${appearance}@2x.png`,
    `favicon-${appearance}-windows.ico`,
    `favicon-${appearance}-512.png`,
    `favicon-${appearance}-1024.png`,
  ]),
  "manifest.json",
];

/** Extract the complete transparent mark, including its three light trails. */
export function compactArtwork(source, { template = false } = {}) {
  const mark = source.match(
    /<symbol id="native-mark" viewBox="0 0 16 16">([\s\S]*?)<\/symbol>/u,
  )?.[1];
  const color = source.match(/<svg\b[^>]*\bcolor="(#[0-9a-f]{6})"/iu)?.[1];
  if (!mark || !color) {
    throw new Error("Canonical SVG must define native-mark and its ink color");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" color="${template ? "#000000" : color}">${mark}</svg>`;
}

/** A dedicated white tile for the Dock, Finder and mounted installer volume. */
export function macAppArtwork(source) {
  // Keep macOS app artwork separate from the transparent menu-bar, Windows
  // and web assets. The outer margin aligns the tile with other Dock icons;
  // the inset mark leaves breathing room inside the white rounded square.
  const mark = compactArtwork(source).replace(
    "<svg ",
    '<svg x="176" y="176" width="672" height="672" ',
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="184" fill="#ffffff"/>${mark}</svg>`;
}

/** Retain physical density as well as Electron's @2x filename convention. */
export function renderPng(svg, size, dpi = 72) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  const density = Buffer.alloc(9);
  density.writeUInt32BE(Math.round(dpi / 0.0254), 0);
  density.writeUInt32BE(Math.round(dpi / 0.0254), 4);
  density[8] = 1;
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  chunk.write("pHYs", 4, "ascii");
  density.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 17)), 17);
  // PNG signature + IHDR. Resvg emits no existing pHYs chunk.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

export function packIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map(({ png }) => png)]);
}

function packIcns(svg) {
  const bySize = new Map(
    [...new Set(ICNS_ENTRIES.map(([, size]) => size))].map((size) => [
      size,
      renderPng(svg, size),
    ]),
  );
  const chunks = ICNS_ENTRIES.flatMap(([type, size]) => {
    const png = bySize.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(8 + png.length, 4);
    return [header, png];
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function currentManifest() {
  return {
    version: 5,
    generator: await sha256(fileURLToPath(import.meta.url)),
    windowsSizes: WINDOWS_ICON_SIZES,
    macTemplateSizes: [16, 32],
    sources: {
      light: await sha256(sources.light),
      dark: await sha256(sources.dark),
    },
  };
}

async function isCurrent(manifest) {
  if (
    !(
      await Promise.all(
        outputNames.map((name) => exists(join(outputDirectory, name))),
      )
    ).every(Boolean)
  ) {
    return false;
  }
  try {
    const saved = JSON.parse(
      await readFile(join(outputDirectory, "manifest.json"), "utf8"),
    );
    return JSON.stringify(saved) === JSON.stringify(manifest);
  } catch {
    return false;
  }
}

/** Guard every recursive removal so only this generator's build directories qualify. */
async function removeGeneratedDirectory(directory) {
  const target = resolve(directory);
  if (
    dirname(target) !== resolve(buildRoot) ||
    (basename(target) !== "native-icons" &&
      !basename(target).startsWith(".native-icons-"))
  ) {
    throw new Error(`Refusing to remove non-generated directory: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

async function generateAppearance(stagingDirectory, appearance, svg) {
  const glyph = compactArtwork(svg);
  const windowsIcon = packIco(
    WINDOWS_ICON_SIZES.map((size) => ({
      size,
      png: renderPng(glyph, size, 96),
    })),
  );
  await Promise.all([
    writeFile(
      join(stagingDirectory, `favicon-${appearance}.png`),
      renderPng(glyph, 16),
    ),
    writeFile(
      join(stagingDirectory, `favicon-${appearance}@2x.png`),
      renderPng(glyph, 32, 144),
    ),
    writeFile(
      join(stagingDirectory, `favicon-${appearance}-windows.ico`),
      windowsIcon,
    ),
    writeFile(
      join(stagingDirectory, `favicon-${appearance}-512.png`),
      renderPng(svg, 512),
    ),
    writeFile(
      join(stagingDirectory, `favicon-${appearance}-1024.png`),
      renderPng(svg, 1024, 144),
    ),
  ]);
}

export async function generateNativeIcons() {
  const manifest = await currentManifest();
  if (await isCurrent(manifest)) {
    console.log("Native app icons are up to date.");
    return;
  }
  const artworks = Object.fromEntries(
    await Promise.all(
      Object.entries(sources).map(async ([appearance, path]) => [
        appearance,
        await readFile(path, "utf8"),
      ]),
    ),
  );
  // Theme changes must never move the frame or the three points.
  if (
    compactArtwork(artworks.light, { template: true }) !==
    compactArtwork(artworks.dark, { template: true })
  ) {
    throw new Error("Light and dark native marks must have identical geometry");
  }
  await mkdir(buildRoot, { recursive: true });
  const stagingDirectory = await mkdtemp(join(buildRoot, ".native-icons-"));
  try {
    await Promise.all(
      Object.entries(artworks).map(([appearance, svg]) =>
        generateAppearance(stagingDirectory, appearance, svg),
      ),
    );
    const template = compactArtwork(artworks.light, { template: true });
    // Always use dark ink on white, independent of the application theme.
    const macApp = macAppArtwork(artworks.light);
    await Promise.all([
      writeFile(
        join(stagingDirectory, "trayTemplate.png"),
        renderPng(template, 16),
      ),
      writeFile(
        join(stagingDirectory, "trayTemplate@2x.png"),
        renderPng(template, 32, 144),
      ),
      writeFile(join(stagingDirectory, "mac-app.icns"), packIcns(macApp)),
      writeFile(
        join(stagingDirectory, "mac-app-512.png"),
        renderPng(macApp, 512),
      ),
      writeFile(
        join(stagingDirectory, "mac-app-1024.png"),
        renderPng(macApp, 1024, 144),
      ),
      // Pinned shortcuts and the EXE use the same transparent artwork as the
      // running window. Never reintroduce a background during packaging.
      copyFile(
        join(stagingDirectory, "favicon-light-windows.ico"),
        join(stagingDirectory, "icon.ico"),
      ),
      writeFile(
        join(stagingDirectory, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      ),
    ]);
    await removeGeneratedDirectory(outputDirectory);
    await rename(stagingDirectory, outputDirectory);
    console.log(
      "Generated native icons: macOS white app tiles, transparent menu-bar templates and Windows multi-size ICOs.",
    );
  } catch (error) {
    await removeGeneratedDirectory(stagingDirectory);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await generateNativeIcons();
}
