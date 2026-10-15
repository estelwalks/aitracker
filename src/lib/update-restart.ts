import type {} from "../../electron/global";

/** The restart-prompt bodies, all of which interpolate `{version}`. */
export type UpdateRestartBodyKey =
  | "settings.updateRestartBody"
  | "settings.updateRestartBodyMac"
  | "settings.updateRestartBodyLinux"
  | "settings.updateRestartBodyLinuxManual";

/**
 * Which restart-prompt body describes what will actually happen.
 *
 * The prompt is the one place the app states what clicking the button does, so
 * the copy is chosen from the install form rather than from the platform alone:
 * a deb/rpm or unpacked Linux install has no AppImage to replace in place and
 * must not be told that the app will "replace itself and reopen".
 *
 * An unknown form (Linux, but the main process did not say) takes the manual
 * copy on purpose: over-promising a silent install is the defect this wording
 * exists to prevent, and the post-click toast corrects an AppImage user anyway.
 */
export function updateRestartBodyKey(
  platform: string | null,
  linuxInstallForm: "appimage" | "package" | "unpacked" | null,
): UpdateRestartBodyKey {
  if (platform === "darwin") return "settings.updateRestartBodyMac";
  if (platform !== "linux") return "settings.updateRestartBody";
  return linuxInstallForm === "appimage"
    ? "settings.updateRestartBodyLinux"
    : "settings.updateRestartBodyLinuxManual";
}

/**
 * How a "restart to install" click should be reported to the user.
 *
 * The hand-off has four possible endings and only one of them means "another
 * process took over": macOS swaps the bundle, Windows runs the elevated
 * installer, and a Linux AppImage swaps itself in place — but a deb/rpm or
 * unpacked Linux install stops at "the file is here, run this". Reporting that
 * last ending as an install in progress is what made the Linux deb flow look
 * silently broken: the toast promised an install, nothing quit, and the 90 s
 * watchdog then reported a failure that never happened.
 */
export type UpdateRestartOutcome =
  | { readonly kind: "failed" }
  | { readonly kind: "manual"; readonly command: string }
  | { readonly kind: "package-opened" }
  | { readonly kind: "installing" };

type RestartResult = Awaited<
  ReturnType<NonNullable<Window["desktopApi"]>["restartToInstall"]>
>;

export function classifyUpdateRestart(
  result: RestartResult,
): UpdateRestartOutcome {
  if (!result.started) return { kind: "failed" };
  if (result.method === "linux-manual") {
    return {
      kind: "manual",
      command: result.manualCommand ?? result.installerPath ?? "",
    };
  }
  if (result.method === "linux-package-open") return { kind: "package-opened" };
  return { kind: "installing" };
}
