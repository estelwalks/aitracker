import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const lockfiles = [
  join(root, "package-lock.json"),
  join(root, "packages", "skill-scanner", "package-lock.json"),
];
const output = join(root, "THIRD_PARTY_NOTICES.md");

function licenseText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" AND ");
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type;
  }
  return "License metadata unavailable";
}

function packageName(path) {
  const marker = "/node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : path;
}

const packages = new Map();
for (const lockfile of lockfiles) {
  const lock = JSON.parse(await readFile(lockfile, "utf8"));
  for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
    if (!path.includes("node_modules/") || !metadata?.version) continue;
    const name = packageName(path);
    const license = licenseText(metadata.license);
    packages.set(`${name}@${metadata.version}`, {
      name,
      version: metadata.version,
      license,
    });
  }
}

const entries = [...packages.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const counts = new Map();
for (const entry of entries) {
  counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);
}
const summary = [...counts.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([license, count]) => `${license}: ${count}`)
  .join(" · ");

const lines = [
  "# Third-party notices",
  "",
  "This inventory is generated from the committed npm lockfiles. It covers",
  "the root application and the bundled `skill-scanner` workspace, including",
  "development dependencies used to build and test the source distribution.",
  "",
  "License texts and copyright notices remain with each package. When creating",
  "a binary distribution, preserve the corresponding package license files in",
  "the unpacked dependency tree or attach them to the release artifact.",
  "",
  `Packages: ${entries.length}. License summary: ${summary}.`,
  "",
  "Regenerate with `npm run generate:third-party-notices` after dependency",
  "changes; review the diff before committing it.",
  "",
  "| Package | Version | Declared license |",
  "| --- | --- | --- |",
  ...entries.map(
    (entry) =>
      `| \`${entry.name}\` | \`${entry.version}\` | ${entry.license.replaceAll("|", "\\|")} |`,
  ),
  "",
];
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`generated ${output} (${entries.length} packages)`);
