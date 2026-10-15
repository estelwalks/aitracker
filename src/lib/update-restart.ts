import type {} from "../../electron/global";

/** The restart-prompt bodies, all of which interpolate `{version}`. */
export type UpdateRestartBodyKey =
  | "settings.updateRestartBody"
  | "settings.updateRestartBodyMac"
  | "settings.updateRestartBodyLinux"
  | "settings.updateRestartBodyLinuxManual"
  | "settings.updateRestartBodyLinuxPackage";

/** A downloaded distro package, which only a package manager can install. */
function isDistroPackage(assetName: string | null): boolean {
  return assetName !== null && /\.(?:deb|rpm)$/iu.test(assetName);
}

/**
 * Which restart-prompt body describes what will actually happen.
 *
 * The downloaded artifact decides the flow, not the platform, because that is
 * what the click really does with it:
 *   - a `.deb`/`.rpm` goes to the software centre, where the user confirms and
 *     authenticates (installing a distro package needs root, and the app never
 *     escalates);
 *   - an AppImage on an AppImage install is swapped in place by a script that
 *     waits for this process to exit;
 *   - an AppImage on anything else is handed back for the user to run, because
 *     there is no file to replace.
 *
 * The install form is the fallback when no artifact is known yet, and an
 * unknown form takes the manual copy on purpose: over-promising a silent
 * install is the defect this wording exists to prevent, and the post-click
 * toast corrects an AppImage user anyway.
 */
export function updateRestartBodyKey(
  platform: string | null,
  linuxInstallForm: "appimage" | "package" | "unpacked" | null,
  assetName: string | null = null,
): UpdateRestartBodyKey {
  if (platform === "darwin") return "settings.updateRestartBodyMac";
  if (platform !== "linux") return "settings.updateRestartBody";
  if (isDistroPackage(assetName)) {
    return "settings.updateRestartBodyLinuxPackage";
  }
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
