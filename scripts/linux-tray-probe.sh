#!/usr/bin/env bash
# Is the tray icon actually reachable by the desktop shell?
#
# A tray icon that "works" has to satisfy more than "the app did not print an
# error". This waits for the icon's X11 window, confirms it is MAPPED (an
# unmapped window is a created-but-invisible icon, which is exactly how an
# earlier check reached the wrong conclusion), and confirms the shell can see it
# either as an XEmbed tray window or as a registered StatusNotifierItem.
#
# Usage: tray-probe.sh <binary> [display]
set -uo pipefail

BINARY="${1:?usage: tray-probe.sh <binary> [display]}"
DISPLAY_NUM="${2:-:0}"
export DISPLAY="$DISPLAY_NUM"

HOME_DIR="$(mktemp -d /tmp/aitracker-tray.XXXXXX)"
LOG="$HOME_DIR/app.log"
pass=0; fail=0
check() { if [ "$2" = "0" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1)); else printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); fi; }

echo "== tray probe: $BINARY on $DISPLAY_NUM =="
echo "   session: XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"

HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" "$BINARY" >"$LOG" 2>&1 &
APP_PID=$!

# GtkStatusIcon's tray window is created late (it waits on the shell's tray
# selection owner), so poll generously and record when it appears.
tray_window=""
elapsed=0
for _ in $(seq 1 40); do
  sleep 1
  elapsed=$((elapsed+1))
  tray_window="$(xwininfo -root -tree 2>/dev/null | grep '"aitracker"' | grep -E '16x16|22x22|24x24' | grep -oE '0x[0-9a-f]+' | head -1)"
  [ -n "$tray_window" ] && break
done
check "tray window created (after ${elapsed}s)" "$([ -n "$tray_window" ] && echo 0 || echo 1)"

if [ -n "$tray_window" ]; then
  info="$(xwininfo -id "$tray_window" 2>/dev/null)"
  state="$(printf '%s\n' "$info" | sed -n 's/^  Map State: //p')"
  wx="$(printf '%s\n' "$info" | sed -n 's/^  Absolute upper-left X: *//p')"
  wy="$(printf '%s\n' "$info" | sed -n 's/^  Absolute upper-left Y: *//p')"
  ww="$(printf '%s\n' "$info" | sed -n 's/^  Width: *//p')"
  echo "        window=$tray_window ${ww}x${ww} at (${wx},${wy}) Map State=${state}"
  # Unmapped means the shell never adopted the icon: created but invisible.
  check "tray window is mapped (the shell displays it)" \
    "$([ "$state" = "IsViewable" ] && echo 0 || echo 1)"

  # A real tray icon sits in a panel strip, near an edge.
  screen_w="$(xrandr --current 2>/dev/null | sed -n 's/.*current \([0-9]*\) x [0-9]*.*/\1/p' | head -1)"
  screen_h="$(xrandr --current 2>/dev/null | sed -n 's/.*current [0-9]* x \([0-9]*\).*/\1/p' | head -1)"
  in_strip=1
  if [ -n "$screen_w" ] && [ -n "$wy" ]; then
    [ "$wy" -lt 60 ] && in_strip=0
    [ -n "$wx" ] && [ "$wx" -gt $((screen_w - 200)) ] && in_strip=0
  fi
  check "tray window sits in a panel strip (screen ${screen_w:-?}x${screen_h:-?})" "$in_strip"
fi

# The other way a shell can show an icon: a registered StatusNotifierItem.
sni=1
if command -v busctl >/dev/null 2>&1; then
  if busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher \
      org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems 2>/dev/null |
      tr ' ' '\n' | grep -qi "StatusNotifierItem-\|aitracker"; then
    sni=0
  fi
fi
if [ "$sni" = "0" ]; then
  echo "  INFO  a StatusNotifierItem matching this app is registered"
else
  echo "  INFO  no StatusNotifierItem for this app (fine when the XEmbed window is mapped)"
fi

# The shell must be running an XEmbed-capable tray host for the X11 path.
owner=1
if command -v xprop >/dev/null 2>&1; then
  xprop -root _NET_SYSTEM_TRAY_S0 >/dev/null 2>&1 && owner=0
fi
if [ "$owner" = "0" ]; then
  echo "  INFO  an XEmbed tray selection owner is present"
else
  echo "  INFO  no XEmbed tray selection owner on this display"
fi

echo "== tray summary: $pass passed, $fail failed =="
echo "   log: $LOG"
kill "$APP_PID" 2>/dev/null
for _ in $(seq 1 20); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done
kill -9 "$APP_PID" 2>/dev/null
pkill -x aitracker 2>/dev/null
exit "$fail"
