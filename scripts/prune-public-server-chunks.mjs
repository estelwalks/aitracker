// TanStack Start emits server-only implementation chunks alongside the
// browser assets. Keep only chunks that are actually imported by a browser
// chunk (for example, the small server-function client wrappers) and remove
// the otherwise unreachable Node/SQLite implementation graph from public.
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const PUBLIC_ASSETS = join(process.cwd(), ".output", "public", "assets");
const SERVER_CHUNK_PATTERN = /\.server-[^/\\]*\.js$/;

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(file);
      return entry.isFile() && entry.name.endsWith(".js") ? [file] : [];
    }),
  );
  return nested.flat();
}

const files = await listJavaScriptFiles(PUBLIC_ASSETS);
const sources = new Map(
  await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")]),
  ),
);
const serverChunks = files.filter((file) => SERVER_CHUNK_PATTERN.test(file));
const serverByName = new Map(
  serverChunks.map((file) => [basename(file), file]),
);

// Reachability starts at browser chunks and follows only references to server
// chunks. This avoids maintaining a brittle allowlist as route chunks change.
const reachable = new Set();
const pending = files.filter((file) => !SERVER_CHUNK_PATTERN.test(file));
while (pending.length > 0) {
  const file = pending.pop();
  const source = sources.get(file) ?? "";
  for (const [name, serverFile] of serverByName) {
    if (reachable.has(serverFile)) continue;
    if (source.includes(name)) {
      reachable.add(serverFile);
      pending.push(serverFile);
    }
  }
}

const removed = serverChunks.filter((file) => !reachable.has(file));
await Promise.all(removed.map((file) => rm(file)));

console.log(
  `prune-public-server-chunks: kept ${reachable.size}, removed ${removed.length}`,
);
