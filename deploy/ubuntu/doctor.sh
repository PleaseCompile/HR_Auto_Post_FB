#!/usr/bin/env bash
# Quick health report for an HR Auto server. Read-only.
#   sudo bash deploy/ubuntu/doctor.sh
set -uo pipefail

ENV_FILE=/etc/hr-auto/hr-auto.env
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1)"
PORT="${PORT:-4173}"

ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$*"; }

echo "== Services"
for service in hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc hr-auto; do
  if systemctl is-active --quiet "$service"; then ok "$service"; else bad "$service ($(systemctl is-active "$service"))"; fi
done

echo "== HR Auto"
if health="$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then
  ok "health: $health"
  curl -fsS "http://127.0.0.1:$PORT/api/session" | python3 -c '
import json,sys
s=json.load(sys.stdin)
print("  Browser เปิดอยู่:", s["browserOpen"], "| ล็อกอิน Facebook:", s["authenticated"], "| แท็บ:", s["pageCount"])
if s.get("lastError"): print("  เหตุการณ์ล่าสุด:", s["lastError"])'
else
  bad "ไม่ตอบที่พอร์ต $PORT → journalctl -u hr-auto -n 80 --no-pager"
fi

echo "== เครื่อง"
free -h | sed 's/^/  /'
df -h /var/lib/hr-auto 2>/dev/null | sed 's/^/  /'
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)"

echo "== ฟอนต์ไทย"
if fc-list :lang=th 2>/dev/null | grep -q .; then ok "มีฟอนต์ไทย"; else bad "ไม่มีฟอนต์ไทย → sudo apt install fonts-thai-tlwg"; fi

echo "== Chromium"
if ls /opt/hr-auto/browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1; then ok "พบ Chromium ใน /opt/hr-auto/browsers"; else bad "ไม่พบ Chromium → รัน install.sh ใหม่"; fi

echo "== Tailscale"
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve status 2>/dev/null | sed 's/^/  /' || bad "tailscale serve ยังไม่ได้ตั้ง"
else
  echo "  ยังไม่ได้ติดตั้ง (ไม่จำเป็นถ้าใช้ SSH tunnel)"
fi

echo "== Log ล่าสุดของ HR Auto"
journalctl -u hr-auto -n 15 --no-pager 2>/dev/null | sed 's/^/  /'
