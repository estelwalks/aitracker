import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {} from "../../electron/global";
import { useI18n } from "../lib/i18n/context";
import { UPDATE_RESTART_DISMISSED_KEY } from "../lib/update-preferences";
import {
  classifyUpdateRestart,
  updateRestartBodyKey,
} from "../lib/update-restart";
import { AITrackerButton } from "./aitracker";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

type DesktopUpdateState = Awaited<
  ReturnType<NonNullable<Window["desktopApi"]>["getUpdateState"]>
>;

/**
 * Desktop-only global prompt: when a verified update installer finishes
 * downloading (automatically or manually), ask the user to restart the app so
 * the installation can complete. "Later" defers the prompt for that exact
 * version through the shared preference store, so it does not reappear after
 * a reload or app restart until a newer version is downloaded.
 */
export function DesktopUpdateDialogs() {
  const { t } = useI18n();
  const api = typeof window === "undefined" ? undefined : window.desktopApi;
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [platform, setPlatform] = useState<string | null>(null);
  /**
   * Linux only: whether this install can replace itself in place. A deb/rpm or
   * unpacked install cannot, and the prompt must not promise a silent swap it
   * is unable to perform.
   */
  const [linuxInstallForm, setLinuxInstallForm] = useState<
    "appimage" | "package" | "unpacked" | null
  >(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  const previousStatus = useRef<DesktopUpdateState["status"] | null>(null);
  /** True once a restart hand-off was armed (the installer owns the flow). */
  const installStarted = useRef(false);

  useEffect(() => {
    const desktop = api;
    if (!desktop) return;
    let cancelled = false;
    void desktop
      .getUpdateState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    void desktop
      .getRuntimeInfo()
      .then((info) => {
        if (cancelled) return;
        setPlatform(info.platform);
        setLinuxInstallForm(info.linuxInstallForm ?? null);
      })
      .catch(() => undefined);
    void desktop
      .getPreferences()
      .then((prefs) => {
        if (cancelled) return;
        const value = prefs[UPDATE_RESTART_DISMISSED_KEY];
        setDismissedVersion(
          typeof value === "string" && value.length > 0 ? value : null,
        );
        setDismissedLoaded(true);
      })
      .catch(() => setDismissedLoaded(true));
    const unsubscribe = desktop.onUpdateStateChanged((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  // Open the restart prompt when the update finishes downloading (including a
  // first load that finds an installer already waiting), unless the user has
  // already deferred this exact version.
  useEffect(() => {
    if (!state || !dismissedLoaded || !api) return;
    if (state.status !== "downloaded") {
      previousStatus.current = state.status;
      return;
    }
    const alreadySeen = previousStatus.current === "downloaded";
    previousStatus.current = "downloaded";
    if (alreadySeen) return;
    const latest = state.latestVersion;
    if (latest && latest !== dismissedVersion) setRestartOpen(true);
  }, [state, dismissedLoaded, dismissedVersion, api]);

  const deferRestart = () => {
    setRestartOpen(false);
    // A hand-off in flight is not a deferral: the installer owns the flow now.
    if (installStarted.current) return;
    const desktop = api;
    if (!desktop || !state) return;
    const latest = state.latestVersion;
    if (!latest) return;
    setDismissedVersion(latest);
    void desktop
      .setPreference(UPDATE_RESTART_DISMISSED_KEY, latest)
      .catch(() => undefined);
  };

  const restartNow = async () => {
    const desktop = api;
    if (!desktop) return;
    try {
      const outcome = classifyUpdateRestart(await desktop.restartToInstall());
      if (outcome.kind === "failed") {
        toast.error(t("settings.toast.updateRestartFailed"));
        setRestartOpen(false);
        return;
      }
      // The manual Linux hand-off hands the file back instead of installing it:
      // saying "installing" there would be a lie, and the 90 s watchdog would
      // fire on an install that was never started.
      if (outcome.kind === "manual") {
        setRestartOpen(false);
        toast.message(
          t("settings.toast.updateManualInstall", { command: outcome.command }),
          { duration: 20_000 },
        );
        return;
      }
      if (outcome.kind === "package-opened") {
        setRestartOpen(false);
        toast.success(t("settings.toast.updatePackageOpened"));
        return;
      }
      // The silent installer closes this app itself; if it is still running
      // after the timeout the hand-off never happened.
      installStarted.current = true;
      setRestartOpen(false);
      toast.success(t("settings.toast.updateInstalling"));
      window.setTimeout(() => {
        installStarted.current = false;
        toast.message(t("settings.toast.updateInstallTimeout"));
      }, 90_000);
    } catch {
      toast.error(t("settings.toast.updateRestartFailed"));
      setRestartOpen(false);
    }
  };

  if (!api) return null;
  // Four flows now, four different promises: macOS swaps the bundle, Windows
  // runs an elevated installer, Linux swaps an AppImage in place, and a
  // deb/rpm (or unpacked) Linux install ends with the user running one command.
  // Showing the swap copy on a deb install described an install that cannot
  // happen there.
  const restartBodyKey = updateRestartBodyKey(platform, linuxInstallForm);
  const latestVersion = state?.latestVersion ?? null;

  return (
    <AlertDialog
      open={restartOpen}
      onOpenChange={(open) => {
        if (!open) deferRestart();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings.updateRestartTitle")}
          </AlertDialogTitle>
          {latestVersion && (
            <AlertDialogDescription>
              {t(restartBodyKey, { version: latestVersion })}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AITrackerButton variant="ghost" size="sm" onClick={deferRestart}>
            {t("settings.updateLater")}
          </AITrackerButton>
          <AITrackerButton
            variant="primary"
            size="sm"
            onClick={() => void restartNow()}
          >
            {t("settings.updateRestartNow")}
          </AITrackerButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
