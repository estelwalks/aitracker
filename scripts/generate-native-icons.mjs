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
// artwork leaves generous breathing room for window-sized rendering, so crop
// that margin only for the tray export. Windows uses an even tighter crop
// because its notification area gives the icon a fixed 16×16 slot.
const TRAY_ARTWORK_VIEW_BOX = "52 52 920 920";
const WINDOWS_TRAY_ARTWORK_VIEW_BOX = "80 80 864 864";
const outputNames = [
  "favicon-light.png",
  "favicon-light@2x.png",
  "favicon-light-windows.png",
  "favicon-light-512.png",
  "favicon-dark.png",
  "favicon-dark@2x.png",
  "favicon-dark-windows.png",
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
    windowsTrayArtworkViewBox: WINDOWS_TRAY_ARTWORK_VIEW_BOX,
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
  const windowsTraySource = join(
    stagingDirectory,
    `${appearance}-windows-tray.svg`,
  );
  const windowsTraySvg = (await readFile(source, "utf8")).replace(
    'viewBox="0 0 1024 1024"',
    `viewBox="${WINDOWS_TRAY_ARTWORK_VIEW_BOX}"`,
  );
  await writeFile(windowsTraySource, windowsTraySvg, "utf8");
  const windowsTrayIconSet = join(
    stagingDirectory,
    `${appearance}-windows-tray-set`,
  );
  await Promise.all([
    runIconsTool({
      inputFile: traySource,
      outputFormat: "set",
      outDir: trayIconSet,
    }),
    runIconsTool({
      inputFile: windowsTraySource,
      outputFormat: "set",
      outDir: windowsTrayIconSet,
    }),
  ]);

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
      join(windowsTrayIconSet, "16x16.png"),
      join(stagingDirectory, `favicon-${appearance}-windows.png`),
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
    rm(windowsTrayIconSet, { recursive: true, force: true }),
    rm(windowsTraySource, { force: true }),
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
