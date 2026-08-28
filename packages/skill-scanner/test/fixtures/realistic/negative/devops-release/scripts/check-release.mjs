import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
console.log(`${pkg.name}@${pkg.version}`);
