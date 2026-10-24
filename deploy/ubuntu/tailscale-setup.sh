#!/usr/bin/env bash
# Expose HR Auto and the browser view to YOUR devices only, over Tailscale.
# Nothing is opened to the public internet: only devices signed in to your
# Tailscale account can reach these URLs.
#
#   sudo bash deploy/ubuntu/tailscale-setup.sh
#
# Messages are English on purpose: the Linux text console cannot draw Thai.
set -euo pipefail
trap 'echo "!! tailscale-setup.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR

ENV_FILE=/etc/hr-auto/hr-auto.env

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "==> Sign in to Tailscale: open the link printed below in any browser and log in"
  tailscale up
fi

PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1)"
PORT="${PORT:-4173}"

echo "==> Serving HR Auto on https :443 and the browser screen on https :8443 (your tailnet only)"
tailscale serve --bg "http://127.0.0.1:$PORT"
tailscale serve --bg --https=8443 "http://127.0.0.1:6080"

if ! grep -q '^HR_AUTO_REMOTE_VIEW_URL=' "$ENV_FILE"; then
  echo 'HR_AUTO_REMOTE_VIEW_URL=https://{host}:8443/vnc.html?autoconnect=1&resize=scale' >> "$ENV_FILE"
  systemctl restart hr-auto
fi

DNS_NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

cat <<EOF

OK - install the Tailscale app on your phone, sign in with the same account, then open:

   HR Auto         https://$DNS_NAME/
   Browser screen  https://$DNS_NAME:8443/vnc.html?autoconnect=1&resize=scale

If they do not open: in the Tailscale admin console -> DNS, enable MagicDNS
and HTTPS Certificates first.
Status: tailscale serve status
EOF
