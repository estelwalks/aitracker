#!/usr/bin/env bash
# Does the tray's context menu close when the user clicks outside it?
#
# The menu is a native GTK popup created by Electron, so whether it dismisses is
# the toolkit's pointer grab, not the app's logic. This drives the real thing:
# the app opens its own tray menu (see AITRACKER_TRAY_MENU_PROBE in
# electron/main.ts) and records what it observed in a report file; this clicks
# empty desktop and reports whether that menu window is gone.
#
# Everything below is arranged around one fact: the app relaunches itself onto
# XWayland for the tray icon, so there is no single process to watch and the
# replacement does not share this shell's stdout. The report file is the only
# reliable channel, and the pid is never used as a liveness signal — the first
# process is *supposed* to exit.
#
# Usage: tray-menu-probe.sh <binary> [display]
set -uo pipefail

BINARY="${1:?usage: tray-menu-probe.sh <binary> [display]}"
DISPLAY_NUM="${2:-:0}"
export DISPLAY="$DISPLAY_NUM"

HOME_DIR="$(mktemp -d /tmp/aitracker-menu.XXXXXX)"
LOG="$HOME_DIR/app.log"
REPORT="$HOME_DIR/menu-report.txt"
pass=0; fail=0
check() { if [ "$2" = "0" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1)); else printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); fi; }
report() { sed -n 's/^/          /p' "$REPORT" 2>/dev/null || true; }

echo "== tray menu probe: $BINARY on $DISPLAY_NUM =="
echo "   session: XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"

# A second launch cannot be a probe instance: it exits at the single-instance lock
# and raises the existing window instead. Refuse rather than disturb a live session.
if pgrep -x aitracker >/dev/null 2>&1; then
  echo "  FAIL  AITracker is already running; close it and run this again."
  exit 2
fi

AITRACKER_TRAY_MENU_PROBE=1 AITRACKER_TRAY_MENU_PROBE_REPORT="$REPORT" \
HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
  setsid "$BINARY" >"$LOG" 2>&1 &
disown 2>/dev/null || true

# Wait for the app to report a menu window id. That single line means: the process
# that owns the tray got far enough to build the menu AND could see it mapped.
menu_window=""
waited=0
for _ in $(seq 1 60); do
  sleep 1
  waited=$((waited+1))
  menu_window="$(sed -n 's/.*menu window \(0x[0-9a-f]*\).*/\1/p' "$REPORT" 2>/dev/null | tail -1)"
  [ -n "$menu_window" ] && break
  # Stop early when the app has already said it cannot proceed.
  if grep -q 'never placed' "$REPORT" 2>/dev/null; then break; fi
done

if [ -z "$menu_window" ]; then
  echo "  FAIL  the app did not open an observable tray menu (after ${waited}s)"
  echo "        app report:"
  report
  if [ ! -s "$REPORT" ]; then echo "          (nothing written)"; fi
  echo "== tray menu summary: $pass passed, $fail failed =="
  echo "   log: $LOG"
  pkill -x aitracker 2>/dev/null
  exit "$fail"
fi

echo "        menu window $menu_window after ${waited}s"
check "the app opened a tray menu" 0
state="$(xwininfo -id "$menu_window" 2>/dev/null | sed -n 's/^  Map State: //p')"
echo "        Map State=${state:-unknown}"
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
  xwininfo -id "$menu_window" 2>/dev/null | sed -n 's/^/          /p' | head -12
fi

echo "== tray menu summary: $pass passed, $fail failed =="
echo "   log: $LOG"
echo "   report: $REPORT"
pkill -x aitracker 2>/dev/null
exit "$fail"
