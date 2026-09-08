#!/usr/bin/env bash
set -euo pipefail
umask 077
# The platform management socket must stay inaccessible to desktop processes.
[ ! -d /.fly ] || chmod 700 /.fly
export RAKAZO_VNC_HOST=127.0.0.1
: "${CADRE_SCREEN_VIEW_TOKEN:?Screen capability required}"
: "${CADRE_RPC_TOKEN:?Computer capability required}"
install -d -m 700 -o 1000 -g 1000 /home/rakazo
# Runtime grants do not survive a VM restart; the persistent home does.
rm -rf /run/cadre /run/cadre-input
install -d -m 755 /run/cadre-input
install -d -m 700 /run/cadre
rm -f /tmp/.X?-lock /tmp/.X11-unix/X?
python3 -c 'import sys; sys.path.insert(0,"/opt/cadre"); import screens; screens.resume_sessions()'
export CADRE_SHARED_BROWSER_SESSIONS=1
env -u CADRE_SCREEN_VIEW_TOKEN -u CADRE_RPC_TOKEN runuser -u rakazo -- /usr/local/bin/rakazo-computer &
COMPUTER_PID=$!
trap 'kill "$COMPUTER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
x11vnc -display :1 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5901 -xkb -noshm -no6 >/tmp/cadre-control-vnc.log 2>&1 &
DEFAULT_SCREEN_KEY=$(python3 -c 'import sys; sys.path.insert(0,"/opt/cadre"); import screens; print(screens.screen_key())')
python3 /opt/cadre/rfb_input_proxy.py 6001 5901 "$DEFAULT_SCREEN_KEY" >/tmp/cadre-control-input.log 2>&1 &
websockify --heartbeat=30 --web=/usr/share/novnc 127.0.0.1:6081 127.0.0.1:6001 >/tmp/cadre-control-web.log 2>&1 &
for _ in $(seq 1 1200); do
  if [ -f /tmp/cadre-browser-sessions-ready ]; then break; fi
  sleep 0.1
done
[ -f /tmp/cadre-browser-sessions-ready ] || exit 1
python3 /opt/cadre/fly_gateway.py &
wait "$COMPUTER_PID"
