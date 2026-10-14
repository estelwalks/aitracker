#!/usr/bin/env bash
# Does the tray's context menu close when the user clicks outside it?
#
# The menu is a native GTK popup created by Electron's `popUpContextMenu`, so its
# dismissal is the toolkit's pointer grab, not the app's logic. This drives the
# real thing: it opens the menu by clicking the tray icon, clicks on empty
# desktop, and reports whether the menu is still mapped afterwards. A menu that
# survives an outside click is the bug being guarded against.
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

# Menus are separate top-level windows, so "did it close" is measurable as the
# difference between the app's window set before and after. Comparing sets rather
# than matching a size avoids depending on the menu's exact geometry, and the
# unresolved-from-boot tray window cannot be mistaken for a menu.
app_windows() {
  xdotool search --class aitracker 2>/dev/null | sort || true
}

echo "== tray menu probe: $BINARY on $DISPLAY_NUM =="
echo "   session: XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset}"

# The app opens the menu itself when this is set. A synthetic right-click does
# not work: the menu is bound to the tray's own window and xdotool events sent
# there do not reach the handler, so the menu never opens and the probe would
# report a false failure.
export AITRACKER_TRAY_MENU_PROBE=1
HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" AITRACKER_TRAY_MENU_PROBE=1 "$BINARY" >"$LOG" 2>&1 &
APP_PID=$!

# The tray window is created immediately but sits at (0,0) until the desktop
# shell adopts it, so waiting for existence is not enough: the position has to
# settle before a click can land on it. Clicking early was a real false negative
# while building this probe.
tray_window=""
settled_at=""
for _ in $(seq 1 45); do
  sleep 1
  tray_window="$(xwininfo -root -tree 2>/dev/null | grep '"aitracker"' | grep -E '16x16|22x22' | grep -oE '0x[0-9a-f]+' | head -1)"
  [ -z "$tray_window" ] && continue
  geometry="$(xwininfo -id "$tray_window" 2>/dev/null)"
  tx="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left X: *//p')"
  ty="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left Y: *//p')"
  state="$(printf '%s\n' "$geometry" | sed -n 's/^  Map State: //p')"
  if [ "$state" = "IsViewable" ] && { [ "${tx:-0}" != "0" ] || [ "${ty:-0}" != "0" ]; }; then
    settled_at="${tx},${ty}"
    break
  fi
done
check "tray icon appeared and was adopted by the shell" "$([ -n "$settled_at" ] && echo 0 || echo 1)"
[ -n "$settled_at" ] && echo "        adopted at ($settled_at) after ${_}s"
if [ -z "$tray_window" ]; then
  echo "== tray menu summary: $pass passed, $fail failed (no tray, nothing to test) =="
  kill "$APP_PID" 2>/dev/null; pkill -x aitracker 2>/dev/null; exit "$fail"
fi

geometry="$(xwininfo -id "$tray_window" 2>/dev/null)"
tray_x="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left X: *//p')"
tray_y="$(printf '%s\n' "$geometry" | sed -n 's/^  Absolute upper-left Y: *//p')"
tray_w="$(printf '%s\n' "$geometry" | sed -n 's/^  Width: *//p')"
tray_h="$(printf '%s\n' "$geometry" | sed -n 's/^  Height: *//p')"
# Aim at the middle of the icon; a right-click on its edge can miss it.
click_x=$(( tray_x + tray_w / 2 ))
click_y=$(( tray_y + tray_h / 2 ))
echo "        tray at ($tray_x,$tray_y) ${tray_w}x${tray_h}; right-clicking ($click_x,$click_y)"

before="$(app_windows | tr '\n' ' ')"
xdotool mousemove "$click_x" "$click_y" 2>/dev/null
sleep 1
xdotool click 3 2>/dev/null
sleep 3
opened="$(app_windows | tr '\n' ' ')"
echo "        menu windows before=$before after right-click=$opened"
check "right-click opened the menu" "$([ "$opened" != "$before" ] && echo 0 || echo 1)"

if [ "$opened" != "$before" ]; then
  # Click empty desktop, far from both the menu and the tray icon.
  screen_w="$(xrandr --current 2>/dev/null | sed -n 's/.*current \([0-9]*\) x [0-9]*.*/\1/p' | head -1)"
  screen_h="$(xrandr --current 2>/dev/null | sed -n 's/.*current [0-9]* x \([0-9]*\).*/\1/p' | head -1)"
  away_x=$(( ${screen_w:-1920} / 2 ))
  away_y=$(( ${screen_h:-1080} * 3 / 4 ))
  echo "        clicking empty desktop at ($away_x,$away_y)"
  xdotool mousemove "$away_x" "$away_y" 2>/dev/null
  sleep 1
  xdotool click 1 2>/dev/null
  sleep 3
  after="$(app_windows | tr '\n' ' ')"
  echo "        menu windows after outside click=$after"
  check "clicking outside closes the menu" "$([ "$after" = "$before" ] && echo 0 || echo 1)"
fi

echo "== tray menu summary: $pass passed, $fail failed =="
echo "   log: $LOG"
kill "$APP_PID" 2>/dev/null
for _ in $(seq 1 20); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done
kill -9 "$APP_PID" 2>/dev/null
pkill -x aitracker 2>/dev/null
exit "$fail"
