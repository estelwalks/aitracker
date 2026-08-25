/**
 * Windows opens the renderer from persisted snapshots while startup collectors
 * continue in the background. NTFS/Defender and optional WSL probes make those
 * collectors too expensive to keep on the first-paint critical path.
 *
 * macOS deliberately retains the existing strict initialization barrier.
 */
export function shouldAwaitStartupCollectors(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32";
}
