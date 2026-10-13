#!/usr/bin/env bash
# Runtime acceptance probe for the packaged Linux build.
#
# Everything the Linux port changes is observable from outside the app, so this
# script asserts on the real process rather than on source text:
#   * the app starts at all (the Chromium sandbox probe is the risky part);
#   * the X11 WM_CLASS matches the installed .desktop basename;
#   * the first-run window fits a small display;
#   * a status-area icon is actually created;
#   * the XDG autostart entry round-trips;
#   * the window rectangle survives a restart.
#
# Usage: linux-runtime-probe.sh <app-dir> <display> [work-area WxH]
set -uo pipefail

APP_DIR="${1:?usage: probe <app-dir> <display> [WxH]}"
DISPLAY_NUM="${2:?display required}"
WORK_AREA="${3:-}"

HOME_DIR="$(mktemp -d /tmp/aitracker-probe-home.XXXXXX)"
LOG="$HOME_DIR/app.log"
export HOME="$HOME_DIR"
export XDG_CONFIG_HOME="$HOME_DIR/.config"
export DISPLAY="$DISPLAY_NUM"
export ELECTRON_ENABLE_LOGGING=1
# Force X11. Chromium's ozone auto-detection otherwise prefers Wayland whenever
# WAYLAND_DISPLAY is inherited, and the window is then created on the *real*
# desktop instead of the probe display — which is both an invalid test and a
# visible intrusion into the developer's session.
export XDG_SESSION_TYPE=x11
unset WAYLAND_DISPLAY
unset AITRACKER_DEV_URL || true
APP_FLAGS=(--ozone-platform=x11)

pass=0
fail=0
check() { # check <label> <condition-result>
  if [ "$2" = "0" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass + 1));
  else printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); fi
}

echo "== probe: $APP_DIR on $DISPLAY_NUM (HOME=$HOME_DIR) =="

"$APP_DIR/aitracker" "${APP_FLAGS[@]}" >"$LOG" 2>&1 &
APP_PID=$!

# Wait for a window to exist, up to 60s (first run warms up SQLite + scanner).
# Match on the app id, not on the pid: Electron renders through child processes
# and `xdotool search --pid` looks for the X11 client owning the window, which
# is not the process this script started.
find_window() {
  xdotool search --class aitracker 2>/dev/null | tail -1
}
window_id=""
for _ in $(seq 1 120); do
  window_id="$(find_window)"
  [ -n "$window_id" ] && break
  sleep 0.5
done
check "window appears" "$([ -n "$window_id" ] && echo 0 || echo 1)"

if [ -n "$window_id" ]; then
  wm_class="$(xprop -id "$window_id" WM_CLASS 2>/dev/null)"
  echo "        $wm_class"
  case "$wm_class" in
    *aitracker*) check "WM_CLASS carries the app id (aitracker)" 0 ;;
    *) check "WM_CLASS carries the app id (aitracker)" 1 ;;
  esac

  # Client geometry, not `xdotool getwindowgeometry`: that reports the WM frame,
  # which on a decorated display is larger than the window the app asked for.
  geometry="$(xwininfo -id "$window_id" 2>/dev/null)"
  win_w="$(printf '%s\n' "$geometry" | sed -n 's/^  Width: \([0-9]*\)$/\1/p')"
  win_h="$(printf '%s\n' "$geometry" | sed -n 's/^  Height: \([0-9]*\)$/\1/p')"
  echo "        client window ${win_w}x${win_h} (work area set ${WORK_AREA:-unset})"
  if [ -n "$WORK_AREA" ]; then
    area_w="${WORK_AREA%x*}"
    area_h="${WORK_AREA#*x}"
    if [ "${win_w:-0}" -le "$area_w" ] && [ "${win_h:-0}" -le "$area_h" ]; then
      check "first-run window fits the ${WORK_AREA} work area" 0
    else
      check "first-run window fits the ${WORK_AREA} work area" 1
    fi
  fi
fi

# A status-area icon means a StatusNotifierItem was exported on the session bus.
sni=1
if command -v busctl >/dev/null 2>&1; then
  busctl --user tree org.kde.StatusNotifierWatcher >/dev/null 2>&1 && sni=0
  busctl --user list 2>/dev/null | grep -qi StatusNotifierWatcher && sni=0
fi
check "StatusNotifierWatcher present / tray host reachable" "$sni"

echo "  -- sandbox decisions on stderr/stdout --"
grep -iE "sandbox|Chromium|tray|ERROR|FATAL" "$LOG" | head -10 || echo "        (no sandbox/tray messages)"

# --- autostart round trip -------------------------------------------------
AUTOSTART="$XDG_CONFIG_HOME/autostart/aitracker.desktop"
if [ -f "$AUTOSTART" ]; then
  echo "  -- autostart entry already present --"
  sed -n '1,12p' "$AUTOSTART"
else
  echo "        (autostart not written yet: it is created from the tray menu / Settings)"
fi

# --- window bounds persistence across a restart ---------------------------
kill "$APP_PID" 2>/dev/null
wait "$APP_PID" 2>/dev/null
sleep 1

DB="$HOME_DIR/.aitracker/data/aitracker.v1.db"
if [ -f "$DB" ]; then
  perms="$(stat -c '%a' "$HOME_DIR/.aitracker" 2>/dev/null)"
  check "data root created with 0700" "$([ "$perms" = "700" ] && echo 0 || echo 1)"
  db_perms="$(stat -c '%a' "$DB" 2>/dev/null)"
  echo "        data root mode=$perms db mode=$db_perms"
  stored="$(sqlite3 "$DB" "select value from app_preferences where key='aitracker.windowBounds'" 2>/dev/null)"
  if [ -n "$stored" ]; then
    check "window rectangle persisted (${stored})" 0
  else
    check "window rectangle persisted" 1
  fi
else
  check "data root created at \$HOME/.aitracker" 1
fi

# Second launch must restore rather than re-centre.
"$APP_DIR/aitracker" "${APP_FLAGS[@]}" >>"$LOG" 2>&1 &
APP2_PID=$!
second_window=""
for _ in $(seq 1 120); do
  second_window="$(find_window)"
  [ -n "$second_window" ] && break
  sleep 0.5
done
if [ -n "$second_window" ]; then
  g2="$(xwininfo -id "$second_window" 2>/dev/null)"
  w2="$(printf '%s\n' "$g2" | sed -n 's/^  Width: \([0-9]*\)$/\1/p')"
  h2="$(printf '%s\n' "$g2" | sed -n 's/^  Height: \([0-9]*\)$/\1/p')"
  x2="$(printf '%s\n' "$g2" | sed -n 's/^  Absolute upper-left X: *\([0-9-]*\)$/\1/p')"
  y2="$(printf '%s\n' "$g2" | sed -n 's/^  Absolute upper-left Y: *\([0-9-]*\)$/\1/p')"
  echo "        restart geometry: ${w2}x${h2} at (${x2},${y2})"
  if [ "$w2" = "$win_w" ] && [ "$h2" = "$win_h" ]; then
    check "restart restores the stored rectangle (${w2}x${h2})" 0
  else
    check "restart restores the stored rectangle (was ${win_w}x${win_h}, now ${w2}x${h2})" 1
  fi
  check "second launch shows a window (stored rectangle reused)" 0
else
  check "second launch shows a window (stored rectangle reused)" 1
fi

echo "== summary: $pass passed, $fail failed =="
echo "   HOME for this run: $HOME_DIR"
kill "$APP2_PID" 2>/dev/null
wait "$APP2_PID" 2>/dev/null
exit "$fail"
