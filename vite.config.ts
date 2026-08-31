// Standard TanStack Start toolchain: the official @tanstack/react-start Vite
// plugin plus @vitejs/plugin-react, @tailwindcss/vite and vite-tsconfig-paths.
// This replaces the former Lovable build preset (@lovable.dev/vite-tanstack-config),
// whose default Cloudflare/Nitro target stubbed child_process/fs APIs and made
// packaged usage collectors silently fail on other computers.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig((env) => ({
  plugins: [
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our
      // SSR error wrapper). The Vite build reads from this.
      server: { entry: "server" },
      // Keep the import protection the former Lovable preset enabled: server
      // code must never leak into the client bundle.
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    react(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // The emitted `.output/server/server.js` and its chunk files use ESM
    // syntax but a `.js` extension. Mark the directory as a module so the
    // Electron main process can import the entry without a package.json of
    // its own (the legacy Nitro layout shipped one).
    {
      name: "aitracker:server-esm-marker",
      closeBundle() {
        try {
          const target = join(
            process.cwd(),
            ".output",
            "server",
            "package.json",
          );
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(
            target,
            `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`,
          );
        } catch {
          // Non-fatal: the file is written by the next build once the server
          // environment output directory exists.
        }
      },
    },
  ],
  // Build only: inline every server dependency into the bundle. The packaged
  // app ships no full node_modules and the extraResources web/ directory
  // cannot resolve bare imports from the asar at runtime. Dev leaves
  // dependencies external (Node loads them directly), which is required for
  // CJS packages like react in the dev SSR module runner.
  ssr: env.command === "build" ? { noExternal: true } : undefined,
  // TanStack Start writes the client bundle to `.output/public` (static
  // assets) and the server bundle to `.output/server`, the layout the
  // packaged Electron local web server (electron/local-web-server.ts) and the
  // bundle gates (verify-bundle-*) expect. The former Nitro preset produced
  // the same two directories.
  build: { outDir: ".output" },
  environments: {
    client: { build: { outDir: ".output/public" } },
  },
  optimizeDeps: {
    // The desktop renderer opens only after Vite reports ready. Keep every
    // dependency used by the shared shell and dashboard's first render in
    // the initial optimisation batch so discovering Recharts or a server-fn
    // client cannot invalidate the module graph after Electron is visible.
    // Runtime discovery is deliberately disabled: every dependency needed
    // by the first document is in this list, so Vite cannot publish a second
    // optimized-deps generation after Electron has connected.
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "@tanstack/react-query",
      "@tanstack/react-router",
      "lucide-react",
      "sonner",
      "recharts",
      "zod",
    ],
  },
}));
