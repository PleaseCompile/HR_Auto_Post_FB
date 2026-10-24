#!/usr/bin/env bash
# HR Auto server edition installer for Ubuntu 22.04 / 24.04.
#
#   git clone -b server-edition https://github.com/PleaseCompile/HR_Auto_Post_FB.git
#   cd HR_Auto_Post_FB
#   sudo bash deploy/ubuntu/install.sh
#
# Safe to run again: it is also how you update (git pull, then run it again).
# It never touches /var/lib/hr-auto (your data and Facebook session) except to
# create it, and never overwrites /etc/hr-auto/hr-auto.env once it exists.
#
# Messages are English on purpose: the Linux text console cannot draw Thai.
set -euo pipefail
trap 'echo "!! install.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR

APP_DIR=/opt/hr-auto
DATA_DIR=/var/lib/hr-auto
CONFIG_DIR=/etc/hr-auto
ENV_FILE="$CONFIG_DIR/hr-auto.env"
SERVICE_USER=hrauto
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$SOURCE_DIR/deploy/ubuntu"
SERVICES=(hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc hr-auto)

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
as_app() { runuser -u "$SERVICE_USER" -- env HOME="/home/$SERVICE_USER" PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/browsers" "$@"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/ubuntu/install.sh" >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  warn "Only tested on Ubuntu (found ${PRETTY_NAME:-unknown}); continuing anyway"
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  warn "Architecture $(uname -m) is untested (tested on x86_64)"
fi

step "Set timezone to Asia/Bangkok"
timedatectl set-timezone Asia/Bangkok || warn "Could not set timezone; skipping"

step "Install system packages (virtual display, VNC, Thai fonts, SSH)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git rsync build-essential python3 \
  xvfb openbox x11vnc novnc websockify \
  fonts-thai-tlwg fonts-noto-core fonts-noto-color-emoji \
  openssh-server

step "Install Node.js 22"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi
if (( NODE_MAJOR < 22 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node --version) / npm $(npm --version)"

step "Check swap"
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ -z "$(swapon --noheadings)" && $TOTAL_RAM_MB -lt 6000 ]]; then
  echo "RAM ${TOTAL_RAM_MB} MB and no swap: creating 2 GB /swapfile so Chromium is not OOM-killed"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "Skipped (swap already present or enough RAM)"
fi

step "Create system user $SERVICE_USER"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

step "Copy the app to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude browsers \
  --exclude data --exclude test-results --exclude installer \
  "$SOURCE_DIR/" "$APP_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

step "Install dependencies and build"
cd "$APP_DIR"
as_app npm ci --no-audit --no-fund
as_app npx playwright install chromium
# System libraries Chromium needs; must run as root.
PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/browsers" npx playwright install-deps chromium
as_app npm run build

step "Prepare data folder $DATA_DIR (only $SERVICE_USER can read it)"
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
# On Linux the browser profile is protected only by file permissions.
chmod 700 "$DATA_DIR"

step "Settings file $ENV_FILE"
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$DEPLOY_DIR/hr-auto.env.example" "$ENV_FILE"
  echo "Created from the example"
else
  echo "Already exists; not overwritten"
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

step "VNC password (for viewing the browser screen)"
if [[ ! -f "$CONFIG_DIR/vnc.pass" ]]; then
  # VNC passwords are limited to 8 characters. Generated in Python because
  # `tr </dev/urandom | head` dies of SIGPIPE under `set -o pipefail`.
  VNC_PASSWORD="$(python3 -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(8)))')"
  x11vnc -storepasswd "$VNC_PASSWORD" "$CONFIG_DIR/vnc.pass" >/dev/null 2>&1
  printf '%s\n' "$VNC_PASSWORD" > "$CONFIG_DIR/vnc-password.txt"
  chmod 600 "$CONFIG_DIR/vnc-password.txt"
  echo "New VNC password created. Show it with: sudo cat $CONFIG_DIR/vnc-password.txt"
else
  echo "Already exists; unchanged"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR/vnc.pass"
chmod 600 "$CONFIG_DIR/vnc.pass"

step "Install and start systemd services"
for service in "${SERVICES[@]}"; do
  install -m 644 "$DEPLOY_DIR/systemd/$service.service" "/etc/systemd/system/$service.service"
done
systemctl daemon-reload
systemctl enable "${SERVICES[@]/%/.service}" >/dev/null 2>&1
systemctl restart hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc
systemctl restart hr-auto

step "Wait for HR Auto to answer"
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"
PORT="${PORT:-4173}"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" != 1 ]]; then
  warn "HR Auto is not answering. See the log: journalctl -u hr-auto -n 80 --no-pager"
  exit 1
fi
curl -fsS "http://127.0.0.1:$PORT/api/health"; echo

IP_ADDRESS="$(hostname -I | awk '{print $1}')"
LOGIN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo USER)}"
cat <<EOF

OK - HR Auto is running on 127.0.0.1:$PORT of this machine (not exposed to the network).

Open it from another computer, pick one:

  1) SSH tunnel (VM testing / from a PC). On Windows PowerShell:
     ssh -N -L 14173:127.0.0.1:$PORT -L 6080:127.0.0.1:6080 $LOGIN_USER@$IP_ADDRESS
     then open  http://127.0.0.1:14173
     browser screen: http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale

  2) Tailscale (from your phone, anywhere):
     sudo bash deploy/ubuntu/tailscale-setup.sh

VNC password : sudo cat $CONFIG_DIR/vnc-password.txt
Health check : sudo bash deploy/ubuntu/doctor.sh
EOF
