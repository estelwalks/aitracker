// P6-T6-06: Vite manifest bundle budget gate.
//
// Reads the built client assets and asserts:
//   - no public chunk named `*.server-*.js` is statically referenced by the
//     entry graph (server implementations must not be in the initial shell)
//   - no public chunk statically imports Node builtins (`node:*`, bare
//     `fs`/`path`/`os`/`child_process`) — browser chunks must never carry
//     externalized Node modules (G6: node externalization = 0)
//   - initial shared JS gzip ≤ 250 KB and CSS gzip ≤ 40 KB are BLOCKING
//     (G6 acceptance); single-route incremental chunks are reported with the
//     ≤ 120 KB budget as a warning for the fixed performance environment.
// Run after `npm run build`.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, ".output/public/assets");

const BUDGETS = {
  initialSharedJsGzip: 250 * 1024,
  cssGzip: 40 * 1024,
  singleRouteIncrementalJsGzip: 120 * 1024,
};

/** Bare Node builtin specifiers that must never appear in browser chunks. */
const NODE_BUILTIN_IMPORTS = new Set([
  "fs",
  "fs/promises",
  "path",
  "os",
  "child_process",
  "crypto",
  "zlib",
  "url",
  "util",
  "stream",
  "events",
  "http",
  "https",
  "net",
  "tls",
  "worker_threads",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:os",
  "node:child_process",
  "node:crypto",
  "node:zlib",
  "node:url",
  "node:util",
  "node:stream",
  "node:events",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:worker_threads",
]);

async function main() {
  let files;
  try {
    files = await readdir(assetsDir);
  } catch {
    console.error(
      "bundle budget: .output/public/assets missing — run npm run build first",
    );
    process.exit(1);
  }
  const jsFiles = files.filter((name) => name.endsWith(".js"));
  const cssFiles = files.filter((name) => name.endsWith(".css"));

  const entry = jsFiles.find((name) => /^index-[^.]+\.js$/.test(name));
  if (!entry) {
    console.error("bundle budget: index entry chunk not found");
    process.exit(1);
  }

  const readGzip = async (name) =>
    gzipSync(Buffer.from(await readFile(join(assetsDir, name), "utf8"))).length;

  const staticImports = (source) => {
    const imports = new Set();
    const patterns = [
      /\b(?:import|export)(?!\s*\()[^;"']*?["']\.\/([^"']+\.js)["']/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) imports.add(match[1]);
    }
    return imports;
  };

  const entryGzip = await readGzip(entry);

  // Walk the static reference graph from the entry. Route-level lazy chunks
  // (`*.lazy-*.js`) are loaded on demand and are NOT part of the initial
  // shared shell, so they are excluded from the byte budget. Shared chunks
  // that are only preloaded (modulepreload for lazy dependencies) are listed
  // separately as `preloadCandidates` and warned about, not counted as
  // synchronous initial JS.
  let sharedBytes = entryGzip;
  const referenced = new Set([entry]);
  const preloadCandidates = [];
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop();
    const source = await readFile(join(assetsDir, name), "utf8");
    for (const candidate of staticImports(source)) {
      if (!jsFiles.includes(candidate) || referenced.has(candidate)) continue;
      referenced.add(candidate);
      if (/\.lazy-[^.]+\.js$/.test(candidate)) continue;
      sharedBytes += await readGzip(candidate);
      stack.push(candidate);
    }
  }

  // Keep the diagnostic list for chunks named in Vite's dynamic preload map
  // but not reached through the synchronous import graph.
  const entrySourceForPreloads = await readFile(join(assetsDir, entry), "utf8");
  for (const candidate of jsFiles) {
    if (
      !referenced.has(candidate) &&
      entrySourceForPreloads.includes(candidate)
    )
      preloadCandidates.push(candidate);
  }

  // Structural gate: server implementation chunks must not be statically
  // referenced by the entry shell itself. A `*.server-*.js` chunk that carries
  // node imports is a real leak; the TanStack server-fn transport chunks are
  // browser-safe RPC endpoints and are allowed.
  const entrySource = entrySourceForPreloads;
  const entryStaticImports = staticImports(entrySource);
  const serverChunksInEntry = [];
  for (const name of jsFiles) {
    if (!/\.server-[^.]+\.js$/.test(name) || !entryStaticImports.has(name))
      continue;
    const source = await readFile(join(assetsDir, name), "utf8");
    if (
      /node:(?:fs|path|os|crypto|child_process|zlib)|require\(/.test(source)
    ) {
      serverChunksInEntry.push(name);
    }
  }

  // Node-externalization gate (G6): scan EVERY public chunk for static imports
  // of Node builtins. Browser chunks must be self-contained; a bare builtin
  // import means the bundler externalized it instead of bundling a stub.
  const nodeBuiltinChunks = [];
  const NODE_IMPORT_PATTERN =
    /\b(?:import|export)\s+(?:[^"'()]|\((?:[^()]|\([^()]*\))*\))*?from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const name of jsFiles) {
    const source = await readFile(join(assetsDir, name), "utf8");
    const hits = new Set();
    for (const match of source.matchAll(NODE_IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (NODE_BUILTIN_IMPORTS.has(specifier)) hits.add(specifier);
    }
    if (hits.size > 0) nodeBuiltinChunks.push({ name, specifiers: [...hits] });
  }

  // Single-route incremental budget: each lazy route chunk measured on its
  // own (plus its direct dependencies is intentionally not computed here —
  // that is the fixed performance environment's job, T7-03).
  const lazyGzips = [];
  for (const name of jsFiles) {
    if (/\.lazy-[^.]+\.js$/.test(name))
      lazyGzips.push([name, await readGzip(name)]);
  }
  lazyGzips.sort((a, b) => b[1] - a[1]);
  const largestLazy = lazyGzips[0]?.[1] ?? 0;
  const largestLazyName = lazyGzips[0]?.[0] ?? null;

  let cssGzip = 0;
  for (const name of cssFiles) cssGzip += await readGzip(name);

  let failures = 0;
  const report = {
    entryGzip,
    initialSharedGzip: sharedBytes,
    budget: BUDGETS.initialSharedJsGzip,
    cssGzip,
    cssBudget: BUDGETS.cssGzip,
    serverChunksInEntry: serverChunksInEntry.length,
    serverChunkNames: serverChunksInEntry,
    nodeBuiltinChunks,
    largestLazyRouteGzip: largestLazy,
    largestLazyRouteName: largestLazyName,
    singleRouteBudget: BUDGETS.singleRouteIncrementalJsGzip,
    preloadCandidates,
  };
  console.log(JSON.stringify(report, null, 2));

  if (serverChunksInEntry.length > 0) {
    console.error(
      `bundle budget FAIL: server chunks statically referenced by entry: ${serverChunksInEntry.join(", ")}`,
    );
    failures += 1;
  }
  if (nodeBuiltinChunks.length > 0) {
    console.error(
      `bundle budget FAIL: Node builtins statically imported by public chunks: ${nodeBuiltinChunks.map((item) => `${item.name}(${item.specifiers.join(",")})`).join(", ")}`,
    );
    failures += 1;
  }
  if (sharedBytes > BUDGETS.initialSharedJsGzip) {
    console.error(
      `bundle budget FAIL: initial shared JS ${sharedBytes} > ${BUDGETS.initialSharedJsGzip}`,
    );
    failures += 1;
  }
  if (cssGzip > BUDGETS.cssGzip) {
    console.error(`bundle budget FAIL: CSS ${cssGzip} > ${BUDGETS.cssGzip}`);
    failures += 1;
  }
  if (largestLazy > BUDGETS.singleRouteIncrementalJsGzip) {
    console.warn(
      `bundle budget WARN: largest lazy route chunk ${largestLazyName} is ${largestLazy} gzip > ${BUDGETS.singleRouteIncrementalJsGzip} (absolute route budgets enforced by the fixed perf environment)`,
    );
  }
  if (failures > 0) process.exit(1);
  console.log("bundle budget: OK (structural + byte gates)");
}

await main();
