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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runIconsTool } from "../node_modules/app-builder-lib/out/toolsets/icons.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = join(projectRoot, "build");
const outputDirectory = join(buildRoot, "native-icons");
const sources = {
  light: join(projectRoot, "public", "favicon.svg"),
  dark: join(projectRoot, "public", "favicon-dark.svg"),
};
// Electron's recommended macOS tray canvas is 16×16 (32×32 @2x). The app
// artwork leaves generous breathing room for Dock-sized rendering, so crop
// that margin only for the tray export. This makes the visible mark about 11%
// larger while preserving the native menu-bar canvas used by other apps.
const TRAY_ARTWORK_VIEW_BOX = "52 52 920 920";
const outputNames = [
  "favicon-light.png",
  "favicon-light@2x.png",
  "favicon-light-512.png",
  "favicon-dark.png",
  "favicon-dark@2x.png",
  "favicon-dark-512.png",
  "manifest.json",
];

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
    version: 2,
    trayArtworkViewBox: TRAY_ARTWORK_VIEW_BOX,
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

async function generateAppearance(stagingDirectory, appearance, source) {
  const appIconSet = join(stagingDirectory, `${appearance}-app-set`);
  await runIconsTool({
    inputFile: source,
    outputFormat: "set",
    outDir: appIconSet,
  });

  const traySource = join(stagingDirectory, `${appearance}-tray.svg`);
  const traySvg = (await readFile(source, "utf8")).replace(
    'viewBox="0 0 1024 1024"',
    `viewBox="${TRAY_ARTWORK_VIEW_BOX}"`,
  );
  await writeFile(traySource, traySvg, "utf8");
  const trayIconSet = join(stagingDirectory, `${appearance}-tray-set`);
  await runIconsTool({
    inputFile: traySource,
    outputFormat: "set",
    outDir: trayIconSet,
  });

  await Promise.all([
    copyFile(
      join(trayIconSet, "16x16.png"),
      join(stagingDirectory, `favicon-${appearance}.png`),
    ),
    copyFile(
      join(trayIconSet, "32x32.png"),
      join(stagingDirectory, `favicon-${appearance}@2x.png`),
    ),
    copyFile(
      join(appIconSet, "512x512.png"),
      join(stagingDirectory, `favicon-${appearance}-512.png`),
    ),
  ]);
  await Promise.all([
    rm(appIconSet, { recursive: true, force: true }),
    rm(trayIconSet, { recursive: true, force: true }),
    rm(traySource, { force: true }),
  ]);
}

async function main() {
  const manifest = await currentManifest();
  if (await isCurrent(manifest)) {
    console.log("Native app icons are up to date.");
    return;
  }

  await mkdir(buildRoot, { recursive: true });
  const stagingDirectory = await mkdtemp(join(buildRoot, ".native-icons-"));
  try {
    await Promise.all(
      Object.entries(sources).map(([appearance, source]) =>
        generateAppearance(stagingDirectory, appearance, source),
      ),
    );
    await writeFile(
      join(stagingDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, outputDirectory);
    console.log("Generated native app icons from public/favicon*.svg.");
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

await main();
