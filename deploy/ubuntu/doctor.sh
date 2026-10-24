#!/usr/bin/env bash
# Quick health report for an HR Auto server. Read-only.
#   sudo bash deploy/ubuntu/doctor.sh
# Messages are English on purpose: the Linux text console cannot draw Thai.
set -uo pipefail

ENV_FILE=/etc/hr-auto/hr-auto.env
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1)"
PORT="${PORT:-4173}"

ok() { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; }

echo "== Services"
for service in hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc hr-auto; do
  if systemctl is-active --quiet "$service"; then ok "$service"; else bad "$service ($(systemctl is-active "$service"))  -> journalctl -u $service -n 40 --no-pager"; fi
done

echo "== HR Auto"
if health="$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then
  ok "health: $health"
  curl -fsS "http://127.0.0.1:$PORT/api/session" | python3 -c '
import json, sys
s = json.load(sys.stdin)
print("  browser open:", s["browserOpen"], "| facebook logged in:", s["authenticated"], "| tabs:", s["pageCount"])
if s.get("lastError"):
    print("  last browser event:", s["lastError"].encode("ascii", "replace").decode())'
else
  bad "no answer on port $PORT -> journalctl -u hr-auto -n 80 --no-pager"
fi

echo "== Machine"
free -h | sed 's/^/  /'
df -h /var/lib/hr-auto 2>/dev/null | sed 's/^/  /'
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)"

echo "== Thai fonts"
# Capture first: `fc-list | grep -q` makes fc-list die of SIGPIPE, which
# pipefail reports as failure even when Thai fonts are present.
THAI_FONTS="$(fc-list :lang=th family 2>/dev/null | sort -u)"
if [[ -n "$THAI_FONTS" ]]; then
  ok "Thai fonts: $(printf '%s' "$THAI_FONTS" | wc -l) families (e.g. $(printf '%s' "$THAI_FONTS" | head -1))"
else
  bad "no Thai fonts -> sudo apt install fonts-thai-tlwg fonts-noto-core"
fi

echo "== Disk"
ROOT_AVAIL_GB="$(df --output=avail -BG / | tail -1 | tr -dc '0-9')"
if (( ROOT_AVAIL_GB < 5 )); then
  bad "only ${ROOT_AVAIL_GB} GB free on / (evidence screenshots need room)"
  if command -v lvs >/dev/null 2>&1 && [[ -n "$(vgs --noheadings -o vg_free --units g 2>/dev/null | tr -dc '0-9.' )" ]]; then
    echo "       unallocated LVM space: $(vgs --noheadings -o vg_name,vg_free --units g 2>/dev/null | xargs)"
    echo "       grow / into it: sudo lvextend -r -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv"
  fi
else
  ok "${ROOT_AVAIL_GB} GB free on /"
fi

echo "== Chromium"
if ls /opt/hr-auto/browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1; then ok "Chromium found in /opt/hr-auto/browsers"; else bad "Chromium missing -> run install.sh again"; fi

echo "== VNC password"
if [[ -f /etc/hr-auto/vnc.pass ]]; then ok "/etc/hr-auto/vnc.pass exists"; else bad "missing -> run install.sh again"; fi

echo "== Tailscale"
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve status 2>/dev/null | sed 's/^/  /' || bad "tailscale serve not configured"
else
  echo "  not installed (not needed when using an SSH tunnel)"
fi

echo "== Recent HR Auto log"
journalctl -u hr-auto -n 15 --no-pager 2>/dev/null | sed 's/^/  /'
