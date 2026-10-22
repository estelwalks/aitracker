import { createHash } from "node:crypto";
import {
  access,
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

/**
 * Sizes for the freedesktop icon set Linux packaging needs.
 *
 * electron-builder installs each file as
 * `/usr/share/icons/hicolor/<size>x<size>/apps/<executableName>.png` and reads
 * the size from the file name, so these must be the standard hicolor sizes.
 * 1024 is deliberately absent: it is not a hicolor directory and would install
 * into a non-standard `hicolor/1024x1024/`.
 */
export const LINUX_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

/** Relative name of each Linux icon inside the output directory. */
export function linuxIconName(size) {
  return `linux/${size}x${size}.png`;
}

/**
 * Dedicated status-area artwork for Linux.
 *
 * The shared `favicon-*.png` tray files are 16px, while a Linux panel draws the
 * status icon at 22–24px (and at 2× that on HiDPI). Handing the panel a 16px
 * bitmap makes it upscale a blurry icon, so the panel size is rasterized
 * directly. Both appearances are emitted: unlike macOS there is no template
 * mask, and `nativeTheme.shouldUseDarkColors` follows the GTK theme, which does
 * not always match the panel background.
 */
export function linuxTrayIconName(appearance, size) {
  return `linux/tray-${appearance}-${size}.png`;
}

export const LINUX_TRAY_ICON_SIZES = [22, 24, 44, 48];
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
  "windows-app.ico",
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
  ...LINUX_ICON_SIZES.map(linuxIconName),
  ...Object.keys(sources).flatMap((appearance) =>
    LINUX_TRAY_ICON_SIZES.map((size) => linuxTrayIconName(appearance, size)),
  ),
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

/**
 * Status-area artwork for Linux.
 *
 * The shared `compactArtwork` mark is drawn for the 1024px app icon: corner
 * brackets on a 1.25/16 stroke and trails on 0.9-1.5/16. Rasterized at the 22px
 * a Linux panel actually draws, that is a ~1.7px hairline — measured coverage of
 * fully-opaque pixels is only 14%, so the mark reads as a faint outline against
 * the panel and disappears entirely on a dark one.
 *
 * The geometry is therefore redrawn for the panel: the same paths and the same
 * relative composition, scaled up by 1/0.78 (a 16-unit frame drawn inside a
 * 12.5-unit box) so the mark fills more of the canvas, with stroke weights
 * raised to a proportion that still has solid mass at 22px. Frame, trails and
 * nodes keep their original paths and ratios; only the scale and the weights
 * differ, which is the standard treatment for a small-size variant.
 *
 * This is Linux-only on purpose. macOS uses its own template mask and Windows
 * its own multi-size ICO, so neither is affected.
 */
export function linuxTrayArtwork(source) {
  // Keep the mark at full size — the frame already uses the whole 16-unit grid
  // and shrinking it only makes the strokes thinner. The fix is ink weight: at
  // the 22px a panel draws, the 1024px design's 1.25/16 frame bracket is a
  // ~1.7px hairline that never reaches full opacity, so the mark reads as a
  // faint outline. 1.5 puts the frame stroke at a full 2.25px and the largest
  // node near 3.6px across, which is the most ink that still leaves the corner
  // brackets inside the canvas — the frame sits 1.75 units from the edge, so a
  // heavier weight starts clipping at 22px. Measured coverage goes from 14% of
  // the canvas fully opaque to 23%.
  const inkScale = 1.5;
  let mark = compactArtwork(source);
  for (const original of ["1.25", "0.9", "1.2", "1.5"]) {
    mark = mark.replace(
      `stroke-width="${original}"`,
      `stroke-width="${(Number(original) * inkScale).toFixed(3)}"`,
    );
  }
  // The trail nodes scale with the frame; make them read as dots rather than
  // specks at panel size.
  for (const [from, to] of [
    ["0.8", "1.0"],
    ["1.1", "1.3"],
    ["1.45", "1.7"],
  ]) {
    mark = mark.replace(`r="${from}"`, `r="${to}"`);
  }
  return mark;
}

/**
 * How much of the canvas the white plate fills on the platforms that do not
 * have the macOS Dock's margin.
 *
 * `macAppArtwork` is drawn on a 1024 artboard whose outer margin is sized for
 * the Dock: the tile occupies 824/1024 = 80.5% of it. Launchers elsewhere frame
 * icons differently — a GNOME app grid holds 81-100% (chromium and syncthing
 * fill the whole canvas), and a Windows desktop draws the icon in a box its
 * neighbours fill — so an 80.5% tile reads as undersized. 88% puts it in the
 * range those neighbours occupy without crowding it against the edge, and
 * rewinding to the tile's own bounds (1.0) would lose the breathing room.
 */
const PLATFORM_TILE_COVERAGE = 0.88;

/**
 * The white app tile, re-framed to fill more of the canvas.
 *
 * Cropping the viewBox rather than redrawing keeps a single source of truth:
 * the plate, its radius and the mark keep the exact proportions macOS uses, so
 * nothing here needs revisiting when macAppArtwork changes.
 */
function tiledAppArtwork(source, coverage) {
  const MACOS_TILE_COVERAGE = 824 / 1024;
  const artboard = 1024;
  const span = (MACOS_TILE_COVERAGE * artboard) / coverage;
  const offset = (artboard - span) / 2;
  const artwork = macAppArtwork(source);
  const inner = artwork.match(/<svg[^>]*>([\s\S]*)<\/svg>/u)?.[1];
  if (!inner) throw new Error("macAppArtwork must render a single svg element");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" ' +
    `viewBox="${offset.toFixed(2)} ${offset.toFixed(2)} ${span.toFixed(2)} ${span.toFixed(2)}">` +
    `${inner}</svg>`
  );
}

/**
 * The Linux application icon for the freedesktop hicolor set.
 *
 * A hicolor icon is a single file installed by the package manager, so unlike
 * the tray artwork it cannot follow the theme. It is the macOS app tile (a white
 * plate carrying the dark-ink mark) because the two obvious transparent
 * alternatives fail on half of all desktops: the dark-ink mark (#111827) is
 * invisible in a dark dock, and the light-ink mark (#f8fafc) is invisible in a
 * light one. A white plate works on both, and the dark ink stays legible on it.
 *
 * Linux only. macOS ships the same tile with its Dock margin (macAppArtwork)
 * and Windows its own plated ICO (windowsAppArtwork); neither is touched.
 */
export function linuxAppArtwork(source) {
  return tiledAppArtwork(source, PLATFORM_TILE_COVERAGE);
}

/**
 * The Windows application icon for the EXE, its pinned shortcuts, the window and
 * the taskbar.
 *
 * Windows draws these at 24-48px over whatever wallpaper the user chose. The
 * plate-free artwork the tray uses disappears at that size: the mark is ink
 * only, with nothing separating it from a photograph, so the desktop icon reads
 * as an unclear smudge. Plating it on the same white tile macOS and Linux use
 * fixes that without inventing a third design — the mark, its weight and its
 * placement stay identical to every other surface.
 *
 * The tray deliberately keeps the plate-free ICO: at 16px in the notification
 * area a white square is the unclear shape instead.
 */
export function windowsAppArtwork(source) {
  return tiledAppArtwork(source, PLATFORM_TILE_COVERAGE);
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
    // 6 -> 7 added the Linux status-area artwork; 7 -> 8 thickened its ink for
    // panel legibility; 11 -> 12 moved the Windows app icon onto the white plate
    // and split it out of the tray ICO. An existing tree must be regenerated
    // rather than reported as current.
    version: 12,
    generator: await sha256(fileURLToPath(import.meta.url)),
    windowsSizes: WINDOWS_ICON_SIZES,
    linuxSizes: LINUX_ICON_SIZES,
    linuxTraySizes: LINUX_TRAY_ICON_SIZES,
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

/**
 * The freedesktop hicolor set. Uses the same transparent artwork as the Windows
 * ICO and the running window — never the macOS white Dock tile, which would put
 * a white square behind the mark on a Linux dock or taskbar.
 */
async function generateLinuxIcons(stagingDirectory, svg, artworks) {
  // Pass `svg` — the light-theme source, whose ink is dark — and not the
  // dark-theme one. The app tile has a white plate, so the dark-theme source
  // (light ink) painted white on white and the icon came out as an empty white
  // square. The inks are not interchangeable: they exist so that a mark stays
  // legible on a given background.
  const glyph = linuxAppArtwork(svg);
  const directory = join(stagingDirectory, "linux");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    ...LINUX_ICON_SIZES.map((size) =>
      writeFile(
        join(stagingDirectory, linuxIconName(size)),
        renderPng(glyph, size, 96),
      ),
    ),
    ...Object.entries(artworks).flatMap(([appearance, artwork]) =>
      LINUX_TRAY_ICON_SIZES.map((size) =>
        writeFile(
          join(stagingDirectory, linuxTrayIconName(appearance, size)),
          // The panel-size variant, not the 1024px app-icon mark: see
          // linuxTrayArtwork for why the hairlines are thickened.
          // 96dpi keeps the bitmap at its native pixel dimensions.
          renderPng(linuxTrayArtwork(artwork), size, 96),
        ),
      ),
    ),
  ]);
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
    // One plate, two names: electron-builder embeds `icon.ico` in the EXE and
    // pins it to the desktop/Start-menu shortcuts, while the running window and
    // the taskbar read `windows-app.ico` from resources/native-icons. They have
    // to be the same artwork or the shortcut and its running window disagree.
    const windowsApp = windowsAppArtwork(artworks.light);
    const windowsAppIco = packIco(
      WINDOWS_ICON_SIZES.map((size) => ({
        size,
        png: renderPng(windowsApp, size, 96),
      })),
    );
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
      // The EXE, its pinned shortcuts and the running window share the plated
      // Windows app icon. The transparent per-appearance ICOs stay for the tray,
      // where a white square would be the unclear shape at 16px.
      writeFile(join(stagingDirectory, "icon.ico"), windowsAppIco),
      writeFile(join(stagingDirectory, "windows-app.ico"), windowsAppIco),
      writeFile(
        join(stagingDirectory, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      ),
      generateLinuxIcons(stagingDirectory, artworks.light, artworks),
    ]);
    await removeGeneratedDirectory(outputDirectory);
    await rename(stagingDirectory, outputDirectory);
    console.log(
      "Generated native icons: macOS white app tiles, transparent menu-bar templates, the Windows plated app ICO plus transparent tray ICOs, and the Linux hicolor PNG set.",
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
