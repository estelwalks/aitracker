// Bundles electron/preload.cts into a single-file build/electron/preload.cjs.
//
// The BrowserWindow uses sandbox: true, and Electron's sandboxed preload
// scripts may only require a small builtin whitelist — they cannot resolve
// relative modules like "./contracts.js". tsc emits preload.cjs with those
// relative requires, which fails at runtime with "module not found". esbuild
// inlines contracts/app-config so the packaged preload is self-contained.
import { build } from "esbuild";

await build({
  entryPoints: ["electron/preload.cts"],
  outfile: "build/electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: true,
});

console.log(
  "bundled build/electron/preload.cjs (sandbox-safe, no relative requires)",
);
