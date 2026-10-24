#!/usr/bin/env bash
# Expose HR Auto and the browser view to YOUR devices only, over Tailscale.
# Nothing is opened to the public internet: only devices signed in to your
# Tailscale account can reach these URLs.
#
#   sudo bash deploy/ubuntu/tailscale-setup.sh
set -euo pipefail

ENV_FILE=/etc/hr-auto/hr-auto.env

if [[ $EUID -ne 0 ]]; then
  echo "ต้องรันด้วย sudo" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> ติดตั้ง Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "==> เข้าสู่ระบบ Tailscale: เปิดลิงก์ที่ขึ้นด้านล่างในเบราว์เซอร์ แล้วล็อกอินบัญชี Tailscale ของคุณ"
  tailscale up
fi

PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1)"
PORT="${PORT:-4173}"

echo "==> เปิด HR Auto (https พอร์ต 443) และหน้าจอ Browser (https พอร์ต 8443) ให้เฉพาะอุปกรณ์ใน Tailscale"
tailscale serve --bg "http://127.0.0.1:$PORT"
tailscale serve --bg --https=8443 "http://127.0.0.1:6080"

if ! grep -q '^HR_AUTO_REMOTE_VIEW_URL=' "$ENV_FILE"; then
  echo 'HR_AUTO_REMOTE_VIEW_URL=https://{host}:8443/vnc.html?autoconnect=1&resize=scale' >> "$ENV_FILE"
  systemctl restart hr-auto
fi

DNS_NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

cat <<EOF

✅ เสร็จแล้ว ลง Tailscale บนมือถือ ล็อกอินบัญชีเดียวกัน แล้วเปิด:

   HR Auto         https://$DNS_NAME/
   หน้าจอ Browser   https://$DNS_NAME:8443/vnc.html?autoconnect=1&resize=scale

ถ้าเปิดไม่ได้ ให้เปิด MagicDNS และ HTTPS Certificates ในหน้า DNS ของ Tailscale admin console ก่อน
ดูสถานะ: tailscale serve status
EOF
