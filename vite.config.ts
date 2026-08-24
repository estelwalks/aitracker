// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Desktop builds execute SSR inside Electron's Node main process. The
  // default Cloudflare preset replaces child_process/fs APIs with unenv stubs,
  // which made packaged usage collectors silently fail on other computers.
  // Lovable sandbox builds still force their Cloudflare preset upstream.
  nitro: { preset: "node-middleware" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
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
  },
});
