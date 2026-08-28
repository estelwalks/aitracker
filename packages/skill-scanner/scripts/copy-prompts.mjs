import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repository, "src", "model", "prompts");
const destinationDir = join(repository, "dist", "prompts");
const prompts = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name);

if (prompts.length === 0) throw new Error(`no prompt files found in ${sourceDir}`);

mkdirSync(destinationDir, { recursive: true });
for (const prompt of prompts) copyFileSync(join(sourceDir, prompt), join(destinationDir, prompt));

console.log(`Copied ${prompts.length} prompt files to dist/prompts.`);
