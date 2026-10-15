"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { RuntimePlatform } from "../platform/runtime/contracts";

/**
 * Which operating system the *host* runs on, as far as the renderer can know.
 *
 * Named `hostPlatform` rather than `platform` on purpose: in the browser
 * companion build the server is a different machine from the browser, so the
 * value describes the host that rendered the page, not the viewing device.
 * `"unknown"` covers a browser talking to a host that reports neither macOS,
 * Windows, nor Linux.
 *
 * Before this existed the renderer had no platform value at all and inferred it
 * two different ways — a user-agent sniff in the title bar and a one-off
 * `getRuntimeInfo()` call in the update dialogs. Both collapsed Linux into the
 * Windows branch, which is why Linux saw Windows-specific copy.
 */
export type HostPlatform = RuntimePlatform;

const PlatformCtx = createContext<HostPlatform>("unknown");

export function PlatformProvider({
  children,
  platform,
}: {
  readonly children: ReactNode;
  readonly platform: HostPlatform;
}) {
  return (
    <PlatformCtx.Provider value={platform}>{children}</PlatformCtx.Provider>
  );
}

export interface PlatformInfo {
  readonly platform: HostPlatform;
  readonly isMac: boolean;
  readonly isWindows: boolean;
  readonly isLinux: boolean;
}

/**
 * Platform facts for UI branching. Hydration-stable: the value comes from the
 * root loader, not from a client-side probe, so the server and the first client
 * render agree.
 */
export function usePlatform(): PlatformInfo {
  const platform = useContext(PlatformCtx);
  return {
    platform,
    isMac: platform === "macos",
    isWindows: platform === "windows",
    isLinux: platform === "linux",
  };
}

/** Map Node's `process.platform` to the renderer's vocabulary. */
export function hostPlatformFromNode(
  platform: NodeJS.Platform | undefined,
): HostPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
}

/**
 * The keyboard-modifier glyph this platform shows in shortcut hints. The
 * bindings themselves already accept both meta and control; only the rendered
 * hint was macOS-only.
 */
export function modifierGlyph(platform: HostPlatform): string {
  return platform === "macos" ? "⌘" : "Ctrl";
}
