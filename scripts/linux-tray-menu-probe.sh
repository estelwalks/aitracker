#!/usr/bin/env bash
# Does the tray's context menu close when the user clicks outside it?
#
# The menu is a native GTK popup created by Electron, so whether it dismisses is
# the toolkit's pointer grab, not the app's logic. This drives the real thing:
# the app opens its own tray menu (see AITRACKER_TRAY_MENU_PROBE in
# electron/main.ts), reports the popup's window id, then this clicks empty
# desktop and reports whether that window is gone.
#
# Two things are deliberate and were both learned the hard way:
#
#   * The menu is opened by the app, not by `xdotool click 3` on the tray window.
#     The menu is bound to that window and a synthesized click never reaches the
#     handler, so no menu appears and the probe reports a false failure.
#   * AITRACKER_NATIVE_WAYLAND=1 is set. Without it the app relaunches itself onto
#     XWayland for the tray icon and the environment is not carried across that
#     relaunch, so the probe variable would be lost and no menu would open.
#
# Usage: tray-menu-probe.sh <binary> [display]
set -uo pipefail

BINARY="${1:?usage: tray-menu-probe.sh <binary> [display]}"
DISPLAY_NUM="${2:-:0}"
export DISPLAY="$DISPLAY_NUM"

HOME_DIR="$(mktemp -d /tmp/aitracker-menu.XXXXXX)"
LOG="$HOME_DIR/app.log"
pass=0; fail=0
check() { if [ "$2" = "0" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1)); else printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); fi; }

echo "== tray menu probe: $BINARY on $DISPLAY_NUM =="
echo "   session: XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"

# A running instance holds the single-instance lock, and a second launch does not
# start a second app: it exits immediately and raises the first one's window via
# `second-instance`. That is what this script used to do — it activated whatever
# the user already had open, produced no tray to inspect, and left the impression
# that the app had hung. Refuse to run rather than disturb a live session.
if pgrep -x aitracker >/dev/null 2>&1 || pgrep -x aitracker-bin >/dev/null 2>&1; then
  echo "  FAIL  AITracker is already running."
  echo "        A second launch exits at once (single-instance lock) and raises the"
  echo "        existing window instead of starting a probe instance."
  echo "        Close AITracker, then run this again."
  exit 2
fi

# AITRACKER_NATIVE_WAYLAND is deliberately NOT set: the tray only exists on the
# X11 backend, so suppressing that relaunch would leave nothing to test. The
# relaunch carries the variables below across explicitly, and the report file is
# how their arrival is confirmed — the replacement process does not share this
# shell's stdout.
REPORT="$HOME_DIR/menu-report.txt"
AITRACKER_TRAY_MENU_PROBE=1 AITRACKER_TRAY_MENU_PROBE_REPORT="$REPORT" \
HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
  "$BINARY" >"$LOG" 2>&1 &
APP_PID=$!

# Confirm the probe instance is actually the one running, rather than a launch that
# lost the lock race.
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "  FAIL  the probe instance exited during startup."
  sed -n '1,5p' "$LOG" | sed 's/^/          /'
  echo "== tray menu summary: 0 passed, 1 failed =="
  echo "   log: $LOG"
  exit 1
fi

# The tray window is created immediately but sits at (0,0) until the shell adopts
# it, so waiting for existence is not enough: an early click lands in the corner.
tray_ready=""
for _ in $(seq 1 45); do
  sleep 1
  tray_window="$(xwininfo -root -tree 2>/dev/null | grep '"aitracker"' | grep -E '16x16|22x22' | grep -oE '0x[0-9a-f]+' | head -1)"
  [ -z "$tray_window" ] && continue
  geometry="$(xwininfo -id "$tray_window" 2>/dev/null)"
  tx="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left X: *//p')"
  ty="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left Y: *//p')"
  state="$(printf '%s\n' "$geometry" | sed -n 's/^  Map State: //p')"
  if [ "$state" = "IsViewable" ] && { [ "${tx:-0}" != "0" ] || [ "${ty:-0}" != "0" ]; }; then
    tray_ready="${tx},${ty}"
    echo "        tray adopted at (${tray_ready})"
    break
  fi
done
check "tray icon appeared and was adopted by the shell" "$([ -n "$tray_ready" ] && echo 0 || echo 1)"

if [ -z "$tray_ready" ]; then
  echo "  INFO  the shell never adopted the tray in this session, so no menu can be observed"
  echo "== tray menu summary: $pass passed, $fail failed =="
  echo "   log: $LOG"
  kill "$APP_PID" 2>/dev/null; pkill -x aitracker 2>/dev/null; exit "$fail"
fi

# The app opens the menu and reports the popup's window id.
menu_window=""
for _ in $(seq 1 40); do
  sleep 1
  menu_window="$(sed -n 's/.*menu window \(0x[0-9a-f]*\).*/\1/p' "$REPORT" 2>/dev/null | tail -1)"
  [ -n "$menu_window" ] && break
done
check "the app opened the tray menu" "$([ -n "$menu_window" ] && echo 0 || echo 1)"

if [ -z "$menu_window" ]; then
  echo "        log tail:"
  tail -5 "$LOG" | sed 's/^/          /'
  echo "== tray menu summary: $pass passed, $fail failed =="
  echo "   log: $LOG"
  kill "$APP_PID" 2>/dev/null; pkill -x aitracker 2>/dev/null; exit "$fail"
fi

state="$(xwininfo -id "$menu_window" 2>/dev/null | sed -n 's/^  Map State: //p')"
echo "        menu window $menu_window, Map State=${state:-unknown}"
check "the menu window is mapped" "$([ "$state" = "IsViewable" ] && echo 0 || echo 1)"

# Click empty desktop, away from the menu, the tray and the panel strip.
screen_w="$(xrandr --current 2>/dev/null | sed -n 's/.*current \([0-9]*\) x [0-9]*.*/\1/p' | head -1)"
screen_h="$(xrandr --current 2>/dev/null | sed -n 's/.*current [0-9]* x \([0-9]*\).*/\1/p' | head -1)"
away_x=$(( ${screen_w:-1920} / 3 ))
away_y=$(( ${screen_h:-1080} * 2 / 3 ))
echo "        clicking empty desktop at ($away_x,$away_y)"
xdotool mousemove "$away_x" "$away_y" 2>/dev/null
sleep 1
xdotool click 1 2>/dev/null
sleep 3

after="$(xwininfo -id "$menu_window" 2>/dev/null | sed -n 's/^  Map State: //p')"
[ "$after" != "IsViewable" ] && echo "        menu Map State is now ${after:-gone}"
check "clicking outside closes the menu" "$([ "$after" != "IsViewable" ] && echo 0 || echo 1)"

if [ "$after" = "IsViewable" ]; then
  echo "  INFO  the menu survived an outside click - this is the reported bug"
  echo "        menu details:"
  xwininfo -id "$menu_window" 2>/dev/null | sed -n 's/^/          /p' | head -12
fi

echo "== tray menu summary: $pass passed, $fail failed =="
echo "   log: $LOG"
kill "$APP_PID" 2>/dev/null
for _ in $(seq 1 20); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done
kill -9 "$APP_PID" 2>/dev/null
pkill -x aitracker 2>/dev/null
exit "$fail"
