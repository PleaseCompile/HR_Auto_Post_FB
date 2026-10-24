#!/usr/bin/env bash
# Starts the VNC server that shows the virtual display (:99) to noVNC.
# Listens on 127.0.0.1 only; people reach it through noVNC.
#
# HR_AUTO_VNC_AUTH (from /etc/hr-auto/vnc.env):
#   password  ask for the VNC password (Tailscale / direct setups)
#   none      no VNC password: Nginx already requires the team login before
#             anyone can open /vnc/, so a second password only gets in the way
#
# Prefers x11vnc; falls back to TigerVNC's x0vncserver where x11vnc is not
# packaged.
set -euo pipefail

AUTH="${HR_AUTO_VNC_AUTH:-password}"
PASSWORD_FILE=/etc/hr-auto/vnc.pass

if command -v x11vnc >/dev/null 2>&1; then
  # -wait/-defer 50 ms: poll and batch screen changes less often, which saves
  # CPU on a single-core server with several people watching.
  args=(-display :99 -localhost -rfbport 5900 -forever -shared -noxdamage -wait 50 -defer 50 -quiet)
  if [[ "$AUTH" == "none" ]]; then
    args+=(-nopw)
  else
    args+=(-rfbauth "$PASSWORD_FILE")
  fi
  exec x11vnc "${args[@]}"
fi

if command -v x0vncserver >/dev/null 2>&1; then
  args=(-display :99 -localhost -rfbport 5900 -AlwaysShared -MaxProcessorUsage 50)
  if [[ "$AUTH" == "none" ]]; then
    args+=(-SecurityTypes None)
  else
    args+=(-SecurityTypes VncAuth -PasswordFile "$PASSWORD_FILE")
  fi
  exec x0vncserver "${args[@]}"
fi

echo "No VNC server found: install x11vnc or tigervnc-scraping-server" >&2
exit 1
