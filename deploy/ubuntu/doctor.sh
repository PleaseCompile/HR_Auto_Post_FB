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

echo "== Browser view (VNC)"
if grep -q "^HR_AUTO_VNC_AUTH=none" /etc/hr-auto/vnc.env 2>/dev/null; then
  ok "protected by the team login through Nginx (no VNC password)"
elif [[ -f /etc/hr-auto/vnc.pass ]]; then
  ok "VNC password set (sudo cat /etc/hr-auto/vnc-password.txt)"
else
  bad "VNC password missing -> run install.sh again"
fi

echo "== Access and security"
ACCESS=""; DOMAIN=""
# shellcheck disable=SC1091
[[ -f /etc/hr-auto/install.conf ]] && . /etc/hr-auto/install.conf
echo "  access mode: ${ACCESS:-unknown}"
if grep -q "^HR_AUTO_PASSWORD_HASH=scrypt:" "$ENV_FILE" 2>/dev/null; then ok "team login is ON"; else
  if [[ "$ACCESS" == "tailscale" ]]; then echo "  team login is off (tailscale mode)"; else bad "team login is OFF -> sudo HR_AUTO_RESET_PASSWORD=1 bash deploy/ubuntu/install.sh"; fi
fi
if [[ "$ACCESS" == "public" || "$ACCESS" == "lan" ]]; then
  if systemctl is-active --quiet nginx; then ok "nginx running"; else bad "nginx not running -> journalctl -u nginx -n 40"; fi
  nginx -t >/dev/null 2>&1 && ok "nginx config valid" || bad "nginx config invalid -> sudo nginx -t"
fi
if [[ "$ACCESS" == "public" && -n "$DOMAIN" ]]; then
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  if [[ -f "$CERT" ]]; then
    EXPIRY="$(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)"
    DAYS_LEFT=$(( ( $(date -d "$EXPIRY" +%s) - $(date +%s) ) / 86400 ))
    if (( DAYS_LEFT > 14 )); then ok "certificate valid for $DAYS_LEFT more days (auto-renews)"; else bad "certificate expires in $DAYS_LEFT days -> sudo certbot renew"; fi
  else
    bad "no certificate for $DOMAIN -> run install.sh again"
  fi
  CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/login" || true)"
  [[ "$CODE" == "200" ]] && ok "https://$DOMAIN/login answers" || bad "https://$DOMAIN/login answered $CODE"
  CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/api/runs" || true)"
  [[ "$CODE" == "401" ]] && ok "API refuses visitors without a login (401)" || bad "API without login answered $CODE (expected 401)"
  ufw status 2>/dev/null | grep -q "Status: active" && ok "firewall active" || bad "firewall off -> sudo ufw enable"
fi

echo "== Memory safety"
swapon --show --noheadings 2>/dev/null | sed "s/^/  swap: /"
[[ -z "$(swapon --show --noheadings 2>/dev/null)" ]] && bad "no swap at all"
grep -q "^OOMScoreAdjust=-500" /etc/systemd/system/hr-auto.service 2>/dev/null && ok "server protected from the OOM killer" || bad "hr-auto.service lacks OOMScoreAdjust -> run install.sh again"

echo "== Backups"
LAST_BACKUP="$(ls -1t /var/backups/hr-auto/hr-auto-*.tar.gz 2>/dev/null | head -1)"
[[ -n "$LAST_BACKUP" ]] && ok "latest backup: $LAST_BACKUP" || echo "  no backup yet (runs nightly at 03:30; now: sudo systemctl start hr-auto-backup)"
systemctl is-active --quiet hr-auto-backup.timer && ok "nightly backup timer on" || bad "backup timer off -> sudo systemctl enable --now hr-auto-backup.timer"

echo "== Tailscale"
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve status 2>/dev/null | sed 's/^/  /' || bad "tailscale serve not configured"
else
  echo "  not installed (not needed when using an SSH tunnel)"
fi

echo "== Recent HR Auto log"
journalctl -u hr-auto -n 15 --no-pager 2>/dev/null | sed 's/^/  /'
