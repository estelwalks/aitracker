import { createServerFn } from "@tanstack/react-start";

import { hostPlatformFromNode, type HostPlatform } from "../lib/platform";

/**
 * Host platform for the root loader.
 *
 * The root loader is isomorphic: TanStack runs it during SSR *and* in the
 * browser when the router revalidates after a navigation or an
 * `invalidate()`. Reading `process.platform` in the loader therefore crashed
 * the renderer with `ReferenceError: process is not defined` (first seen on
 * /agents). Resolving the value through a ServerFn keeps every execution —
 * SSR and client-side revalidation — describing the machine that runs the
 * local web server, which is the same machine as the desktop window.
 */
export const getRootHostPlatform = createServerFn({ method: "GET" }).handler(
  async (): Promise<HostPlatform> => hostPlatformFromNode(process.platform),
);
