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
set -euo pipefail

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
  echo "ต้องรันด้วย sudo: sudo bash deploy/ubuntu/install.sh" >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  warn "สคริปต์นี้ทดสอบกับ Ubuntu เท่านั้น (เจอ ${PRETTY_NAME:-unknown}) จะลองต่อ"
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  warn "สถาปัตยกรรม $(uname -m) ยังไม่ได้ทดสอบ (ทดสอบกับ x86_64)"
fi

step "ตั้งเขตเวลาเป็น Asia/Bangkok"
timedatectl set-timezone Asia/Bangkok || warn "ตั้งเขตเวลาไม่สำเร็จ ข้ามไป"

step "ติดตั้งแพ็กเกจระบบ (จอเสมือน, VNC, ฟอนต์ไทย, SSH)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git rsync build-essential python3 \
  xvfb openbox x11vnc novnc websockify \
  fonts-thai-tlwg fonts-noto-core fonts-noto-color-emoji \
  openssh-server

step "ติดตั้ง Node.js 22"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi
if (( NODE_MAJOR < 22 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node --version) / npm $(npm --version)"

step "ตรวจ swap"
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ -z "$(swapon --noheadings)" && $TOTAL_RAM_MB -lt 6000 ]]; then
  echo "RAM ${TOTAL_RAM_MB} MB และยังไม่มี swap → สร้าง /swapfile 2 GB กัน Chromium โดน OOM kill"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "ข้าม (มี swap แล้ว หรือ RAM มากพอ)"
fi

step "สร้างผู้ใช้ระบบ $SERVICE_USER"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

step "คัดลอกโปรแกรมไปที่ $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude browsers \
  --exclude data --exclude test-results --exclude installer \
  "$SOURCE_DIR/" "$APP_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

step "ติดตั้ง dependencies และ build"
cd "$APP_DIR"
as_app npm ci --no-audit --no-fund
as_app npx playwright install chromium
# System libraries Chromium needs; must run as root.
PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/browsers" npx playwright install-deps chromium
as_app npm run build

step "เตรียมโฟลเดอร์ข้อมูล $DATA_DIR (เข้าถึงได้เฉพาะ $SERVICE_USER)"
mkdir -p "$DATA_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
# On Linux the browser profile is protected only by file permissions.
chmod 700 "$DATA_DIR"

step "ไฟล์ตั้งค่า $ENV_FILE"
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$DEPLOY_DIR/hr-auto.env.example" "$ENV_FILE"
  echo "สร้างใหม่จากตัวอย่าง"
else
  echo "มีอยู่แล้ว ไม่เขียนทับ"
fi
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

step "รหัสผ่าน VNC (ใช้ตอนเปิดดูหน้าจอ Browser)"
if [[ ! -f "$CONFIG_DIR/vnc.pass" ]]; then
  # VNC passwords are limited to 8 characters.
  VNC_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 8)"
  x11vnc -storepasswd "$VNC_PASSWORD" "$CONFIG_DIR/vnc.pass" >/dev/null
  printf '%s\n' "$VNC_PASSWORD" > "$CONFIG_DIR/vnc-password.txt"
  chmod 600 "$CONFIG_DIR/vnc-password.txt"
  echo "สร้างรหัส VNC ใหม่แล้ว ดูได้ด้วย: sudo cat $CONFIG_DIR/vnc-password.txt"
else
  echo "มีอยู่แล้ว ไม่เปลี่ยน"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR/vnc.pass"
chmod 600 "$CONFIG_DIR/vnc.pass"

step "ติดตั้งและเริ่ม systemd services"
for service in "${SERVICES[@]}"; do
  install -m 644 "$DEPLOY_DIR/systemd/$service.service" "/etc/systemd/system/$service.service"
done
systemctl daemon-reload
systemctl enable "${SERVICES[@]/%/.service}" >/dev/null
systemctl restart hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc
systemctl restart hr-auto

step "รอให้ HR Auto พร้อม"
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"
PORT="${PORT:-4173}"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "${READY:-0}" != 1 ]]; then
  warn "HR Auto ยังไม่ตอบ ดู log ด้วย: journalctl -u hr-auto -n 80 --no-pager"
  exit 1
fi
curl -fsS "http://127.0.0.1:$PORT/api/health"; echo

IP_ADDRESS="$(hostname -I | awk '{print $1}')"
cat <<EOF

✅ ติดตั้งเสร็จ HR Auto ทำงานที่ 127.0.0.1:$PORT บนเครื่องนี้ (ไม่เปิดออกเน็ตตรง ๆ)

เข้าใช้งานจากเครื่องอื่น เลือกหนึ่งวิธี:

  1) SSH tunnel (ทดสอบใน VM / ใช้จากคอม):
     ssh -N -L 14173:127.0.0.1:$PORT -L 6080:127.0.0.1:6080 $(logname 2>/dev/null || echo USER)@$IP_ADDRESS
     แล้วเปิด http://127.0.0.1:14173  และหน้าจอ Browser ที่ http://127.0.0.1:6080/vnc.html

  2) Tailscale (ใช้จากมือถือได้ทุกที่):
     sudo bash deploy/ubuntu/tailscale-setup.sh

รหัส VNC: sudo cat $CONFIG_DIR/vnc-password.txt
ตรวจสุขภาพระบบ: sudo bash deploy/ubuntu/doctor.sh
EOF
