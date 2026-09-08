#!/usr/bin/env bash
set -uo pipefail
umask 077
export XCURSOR_THEME=Cadre XCURSOR_SIZE=24
export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/home/rakazo}"
AGENT_HOME="$HOME"
case "$DISPLAY" in :[1-9]) ;; *) echo "Invalid display" >&2; exit 1 ;; esac
DISPLAY_NUMBER="${DISPLAY#:}"
VIEW_VNC_PORT=$((5900 + (DISPLAY_NUMBER - 1) * 2))
VIEW_PORT=$((6080 + (DISPLAY_NUMBER - 1) * 2))
FLUX_HOME="/tmp/fluxbox-home-$DISPLAY_NUMBER"
PROFILE="${RAKAZO_BROWSER_PROFILE:-$AGENT_HOME/.browser-profiles/chromium}"
export RAKAZO_BROWSER_PROFILE="$PROFILE"
mkdir -p "$AGENT_HOME" "$AGENT_HOME/.local/bin" "$AGENT_HOME/.config" /tmp/rakazo /tmp/.X11-unix ${FLUX_HOME}
export PATH="$AGENT_HOME/.local/bin:/usr/local/bin:$PATH"
export NPM_CONFIG_PREFIX="$AGENT_HOME/.local"
export PIP_USER=1
cd "$AGENT_HOME"
# Each display owns its own diagnostics; parallel agents never overwrite them.
LOG_DIR="/tmp/rakazo/display-$DISPLAY_NUMBER"
mkdir -p "$LOG_DIR"
cleanup() {
  trap - EXIT TERM INT
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT
port_ready() { (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; }

if [[ -n "${RAKAZO_COMPUTER_CONTROL_TOKEN:-}" ]]; then
  /usr/local/bin/rakazo-computer-control >"$LOG_DIR"/control.log 2>&1 &
fi

# Reattaching a supervisor must never remove a live server's X socket.
DESKTOP_FRESH=0
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  rm -f "/tmp/.X$DISPLAY_NUMBER-lock" "/tmp/.X11-unix/X$DISPLAY_NUMBER"
  Xvfb "$DISPLAY" -nolisten tcp -screen 0 1280x800x24 -ac +extension RANDR +render -noreset >"$LOG_DIR"/xvfb.log 2>&1 &
  DESKTOP_FRESH=1
fi

ready=0
for _ in $(seq 1 100); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Xvfb failed to start" >&2
  cat "$LOG_DIR"/xvfb.log >&2 || true
  exit 1
fi

if [[ "$DESKTOP_FRESH" -eq 1 ]]; then
if command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
fi

cadre-desktop-appearance
mkdir -p ${FLUX_HOME}/.fluxbox
cp /etc/rakazo/fluxbox/init ${FLUX_HOME}/.fluxbox/init
cp /etc/rakazo/fluxbox/apps ${FLUX_HOME}/.fluxbox/apps 2>/dev/null || true
cp /etc/rakazo/fluxbox/menu ${FLUX_HOME}/.fluxbox/menu 2>/dev/null || true
cat > ${FLUX_HOME}/.fluxbox/startup <<EOF
#!/bin/sh
exec fluxbox -rc ${FLUX_HOME}/.fluxbox/init
EOF
chmod +x ${FLUX_HOME}/.fluxbox/startup
HOME=${FLUX_HOME} ${FLUX_HOME}/.fluxbox/startup >"$LOG_DIR"/fluxbox.log 2>&1 &

tint2 -c /etc/rakazo/tint2rc >"$LOG_DIR"/dock.log 2>&1 &

register_browser_handler() {
  local mime="$1"
  if ! xdg-mime default rakazo-browser.desktop "$mime" >/dev/null 2>&1 \
    || [[ "$(xdg-mime query default "$mime" 2>/dev/null || true)" != "rakazo-browser.desktop" ]]; then
    echo "failed to register rakazo-browser for $mime" >&2
    exit 1
  fi
}
register_browser_handler x-scheme-handler/http
register_browser_handler x-scheme-handler/https
register_browser_handler text/html
if ! xdg-settings set default-web-browser rakazo-browser.desktop >/dev/null 2>&1 \
  || [[ "$(xdg-settings get default-web-browser 2>/dev/null || true)" != "rakazo-browser.desktop" ]]; then
  echo "failed to set default web browser to rakazo-browser" >&2
  exit 1
fi

rm -f "$PROFILE/SingletonLock" \
  "$PROFILE/SingletonCookie" \
  "$PROFILE/SingletonSocket"

HOME="$AGENT_HOME" rakazo-browser >"$LOG_DIR"/browser.log 2>&1 &
browser_up=0
for _ in $(seq 1 40); do
  if xdotool search --onlyvisible --class chromium >/dev/null 2>&1; then
    browser_up=1
    break
  fi
  if xdotool search --onlyvisible --class Chromium >/dev/null 2>&1; then
    browser_up=1
    break
  fi
  sleep 0.25
done
if [[ "$browser_up" -ne 1 ]]; then
  echo "browser failed to start" >&2
  cat "$LOG_DIR"/browser.log >&2 || true
  xterm -geometry 100x28+48+48 -bg "#111113" -fg "#E8E8EA" -cr "#E8E8EA" -title "Terminal" >"$LOG_DIR"/xterm.log 2>&1 &
fi

fi # fresh desktop

start_view_vnc() {
  x11vnc -display "$DISPLAY" -forever -shared -viewonly -nopw -listen 127.0.0.1 -rfbport "$VIEW_VNC_PORT" -xkb -ncache 0 >"$LOG_DIR"/x11vnc.log 2>&1 &
}

NOVNC_ROOT=/usr/share/novnc
if [[ ! -d "$NOVNC_ROOT" ]]; then
  echo "noVNC is missing from the computer image" >&2
  exit 1
fi
if [[ ! -f "$NOVNC_ROOT/embed.html" ]]; then
  echo "noVNC embed.html is missing from the computer image" >&2
  exit 1
fi
if [[ ! -f "$NOVNC_ROOT/clipboard-bridge.js" ]]; then
  echo "noVNC clipboard-bridge.js is missing from the computer image" >&2
  exit 1
fi
start_view_proxy() {
  websockify --heartbeat=30 --web="$NOVNC_ROOT" "${RAKAZO_VNC_HOST:-0.0.0.0}:$VIEW_PORT" "127.0.0.1:$VIEW_VNC_PORT" >"$LOG_DIR"/novnc.log 2>&1 &
}

# Repair a dropped stream without replacing the desktop or its browser tabs.
while xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  port_ready "$VIEW_VNC_PORT" || start_view_vnc
  port_ready "$VIEW_PORT" || start_view_proxy
  sleep 2
done
echo "Xvfb exited" >&2
exit 1
