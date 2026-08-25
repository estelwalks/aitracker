/**
 * Resolve an npm child-process invocation without relying on shell mode.
 * Windows npm is a `.cmd` script, so Node cannot execute it directly; invoke
 * it through the platform command processor instead.
 */
export function resolveNpmSpawn(
  argumentsList,
  { platform = process.platform, environment = process.env } = {},
) {
  if (platform === "win32") {
    return {
      executable: environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe",
      argumentsList: ["/d", "/s", "/c", "npm.cmd", ...argumentsList],
    };
  }
  return { executable: "npm", argumentsList: [...argumentsList] };
}
