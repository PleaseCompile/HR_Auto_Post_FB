#!/usr/bin/env bash
# HR Auto server edition installer for Ubuntu 22.04 / 24.04 / 26.04.
#
#   git clone -b server-edition https://github.com/PleaseCompile/HR_Auto_Post_FB.git
#   cd HR_Auto_Post_FB
#   sudo bash deploy/ubuntu/install.sh
#
# Safe to run again: it is also how you update (git pull, then run it again).
# Answers are remembered in /etc/hr-auto/install.conf, so updates do not ask
# again. Never touches /var/lib/hr-auto (data and Facebook session) except to
# create it, and never overwrites values you edited in /etc/hr-auto/hr-auto.env.
#
# Access modes:
#   public     https://your.domain with Nginx + Let's Encrypt, firewall on
#   lan        plain http on port 80 (testing in a VM / office LAN only)
#   tailscale  no Nginx; reach it through Tailscale (tailscale-setup.sh)
#
# Optional environment overrides (otherwise you are asked):
#   HR_AUTO_ACCESS=public|lan|tailscale  HR_AUTO_DOMAIN=hr.example.com
#   HR_AUTO_LE_EMAIL=you@example.com     HR_AUTO_RESET_PASSWORD=1
#
# Messages are English on purpose: the Linux text console cannot draw Thai.
set -euo pipefail
trap 'echo "!! install.sh failed at line $LINENO: $BASH_COMMAND" >&2' ERR

APP_DIR=/opt/hr-auto
DATA_DIR=/var/lib/hr-auto
CONFIG_DIR=/etc/hr-auto
ENV_FILE="$CONFIG_DIR/hr-auto.env"
INSTALL_CONF="$CONFIG_DIR/install.conf"
SERVICE_USER=hrauto
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$SOURCE_DIR/deploy/ubuntu"
SERVICES=(hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc hr-auto)
ACME_ROOT=/var/www/hr-auto-acme
SMALL_RAM_MB=3000

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
as_app() { runuser -u "$SERVICE_USER" -- env HOME="/home/$SERVICE_USER" PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/browsers" "$@"; }
ask() { # ask "Question" default -> echoes the answer
  local answer
  read -r -p "$1 [$2]: " answer </dev/tty || true
  echo "${answer:-$2}"
}
# Set KEY=VALUE in the env file (replace or append). Values may contain & / spaces.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}
# Add KEY=VALUE only if the key is missing (keeps the user's own edits).
ensure_env() { grep -q "^$1=" "$ENV_FILE" || printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
remember() { # remember KEY VALUE in install.conf
  touch "$INSTALL_CONF"
  grep -v "^$1=" "$INSTALL_CONF" > "$INSTALL_CONF.tmp" || true
  printf '%s=%q\n' "$1" "$2" >> "$INSTALL_CONF.tmp"
  mv "$INSTALL_CONF.tmp" "$INSTALL_CONF"
  chmod 600 "$INSTALL_CONF"
}

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/ubuntu/install.sh" >&2
  exit 1
fi

. /etc/os-release
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ;;
  *) warn "Tested on Ubuntu 22.04/24.04/26.04 (found ${PRETTY_NAME:-unknown}); continuing anyway" ;;
esac
if [[ "$(uname -m)" != "x86_64" ]]; then
  warn "Architecture $(uname -m) is untested (tested on x86_64)"
fi

mkdir -p "$CONFIG_DIR"
# shellcheck disable=SC1090
[[ -f "$INSTALL_CONF" ]] && . "$INSTALL_CONF"
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)

# ---------------------------------------------------------------------------
step "Access mode"
ACCESS="${HR_AUTO_ACCESS:-${ACCESS:-}}"
if [[ -z "$ACCESS" ]]; then
  cat <<'EOF'
  1) public     https://your-domain  (Nginx + free HTTPS certificate + firewall)
  2) lan        http on port 80, for testing in a VM or on an office network
  3) tailscale  no Nginx; use Tailscale (private, nothing exposed)
EOF
  case "$(ask "Choose 1, 2 or 3" 1)" in
    1|public) ACCESS=public ;;
    2|lan) ACCESS=lan ;;
    3|tailscale) ACCESS=tailscale ;;
    *) echo "Unknown choice" >&2; exit 1 ;;
  esac
fi
remember ACCESS "$ACCESS"
echo "Access mode: $ACCESS"

if [[ "$ACCESS" == "public" ]]; then
  DOMAIN="${HR_AUTO_DOMAIN:-${DOMAIN:-}}"
  [[ -z "$DOMAIN" ]] && DOMAIN="$(ask "Domain for HR Auto (DNS A record must point here)" "hr.wanlaza.com")"
  LE_EMAIL="${HR_AUTO_LE_EMAIL:-${LE_EMAIL:-}}"
  [[ -z "$LE_EMAIL" ]] && LE_EMAIL="$(ask "Email for certificate expiry notices" "")"
  if [[ -z "$DOMAIN" || -z "$LE_EMAIL" ]]; then
    echo "Domain and email are required for public mode" >&2
    exit 1
  fi
  remember DOMAIN "$DOMAIN"
  remember LE_EMAIL "$LE_EMAIL"
fi

# ---------------------------------------------------------------------------
step "Set timezone to Asia/Bangkok"
timedatectl set-timezone Asia/Bangkok || warn "Could not set timezone; skipping"

step "Install system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
PACKAGES=(ca-certificates curl git rsync build-essential python3 sqlite3
  xvfb openbox novnc websockify
  fonts-thai-tlwg fonts-noto-core fonts-noto-color-emoji
  openssh-server)
[[ "$ACCESS" != "tailscale" ]] && PACKAGES+=(nginx)
[[ "$ACCESS" == "public" ]] && PACKAGES+=(certbot ufw)
apt-get install -y --no-install-recommends "${PACKAGES[@]}"
# VNC server: x11vnc where packaged, otherwise TigerVNC's scraping server.
if ! command -v x11vnc >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends x11vnc \
    || apt-get install -y --no-install-recommends tigervnc-scraping-server \
    || { echo "Could not install a VNC server (x11vnc or tigervnc-scraping-server)" >&2; exit 1; }
fi

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

step "Memory: compressed swap in RAM (zram) and a small disk swap"
if (( TOTAL_RAM_MB < 6000 )); then
  if apt-get install -y --no-install-recommends systemd-zram-generator >/dev/null 2>&1; then
    cat > /etc/systemd/zram-generator.conf <<'EOF'
# Installed by HR Auto: compressed swap in RAM, used before the disk swap.
[zram0]
zram-size = ram / 2
compression-algorithm = zstd
swap-priority = 100
EOF
    systemctl daemon-reload
    systemctl restart systemd-zram-setup@zram0.service || warn "zram did not start; disk swap only"
  else
    warn "systemd-zram-generator not available; disk swap only"
  fi
  if ! swapon --noheadings --show=NAME | grep -q '^/swapfile$'; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon --priority 10 /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw,pri=10 0 0' >> /etc/fstab
  fi
  swapon --show
else
  echo "Skipped (RAM ${TOTAL_RAM_MB} MB)"
fi

step "Cap system log size"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/hr-auto.conf <<'EOF'
# Installed by HR Auto: keep logs from filling a small disk.
[Journal]
SystemMaxUse=200M
EOF
systemctl restart systemd-journald

# ---------------------------------------------------------------------------
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
chmod 700 "$DATA_DIR"

# ---------------------------------------------------------------------------
step "Settings file $ENV_FILE"
NEW_ENV=0
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$DEPLOY_DIR/hr-auto.env.example" "$ENV_FILE"
  NEW_ENV=1
  echo "Created from the example"
fi
# Keys added in later versions, without touching values you changed.
# (if/then, not &&: a false test as the last command would trip set -e.)
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]]; then
    ensure_env "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  fi
done < "$DEPLOY_DIR/hr-auto.env.example"
# The virtual screen shrank to 1280x800; move the old default window size along.
if grep -qx "HR_AUTO_BROWSER_ARGS=--window-size=1366,900" "$ENV_FILE"; then
  set_env HR_AUTO_BROWSER_ARGS "$(sed -n "s/^HR_AUTO_BROWSER_ARGS=//p" "$DEPLOY_DIR/hr-auto.env.example")"
  echo "Updated browser flags to the new defaults"
fi
if (( NEW_ENV )) && (( TOTAL_RAM_MB < SMALL_RAM_MB )); then
  echo "Small server (${TOTAL_RAM_MB} MB RAM): tuning for 2 tabs"
  set_env HR_AUTO_MIN_FREE_MEMORY_MB 350
  set_env HR_AUTO_MIN_FREE_MEMORY_RATIO 0.08
  BROWSER_ARGS="$(sed -n 's/^HR_AUTO_BROWSER_ARGS=//p' "$ENV_FILE" | tail -1)"
  set_env HR_AUTO_BROWSER_ARGS "$BROWSER_ARGS --renderer-process-limit=4"
fi
case "$ACCESS" in
  public|lan)
    set_env HR_AUTO_REMOTE_VIEW_URL "/vnc/vnc.html?autoconnect=1&resize=scale&path=vnc/websockify&quality=6&compression=2"
    ;;
esac
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

step "Team password"
HAS_PASSWORD=0
grep -q '^HR_AUTO_PASSWORD_HASH=scrypt:' "$ENV_FILE" && HAS_PASSWORD=1
if [[ "$ACCESS" == "tailscale" && "$HAS_PASSWORD" == 0 && -z "${HR_AUTO_RESET_PASSWORD:-}" ]]; then
  echo "Skipped in tailscale mode (only your own devices can reach the app)."
  echo "Turn it on any time: sudo HR_AUTO_RESET_PASSWORD=1 bash deploy/ubuntu/install.sh"
elif [[ "$HAS_PASSWORD" == 1 && -z "${HR_AUTO_RESET_PASSWORD:-}" ]]; then
  echo "Already set; unchanged (change it: sudo HR_AUTO_RESET_PASSWORD=1 bash deploy/ubuntu/install.sh)"
else
  echo "Everyone on the team signs in with this one password (at least 10 characters)."
  echo "Changing it later signs every phone out."
  while true; do
    read -r -s -p "New team password: " PASSWORD_1 </dev/tty; echo
    read -r -s -p "Type it again: " PASSWORD_2 </dev/tty; echo
    if [[ "$PASSWORD_1" != "$PASSWORD_2" ]]; then
      warn "Passwords do not match, try again"
      continue
    fi
    if HASH="$(printf '%s' "$PASSWORD_1" | node "$APP_DIR/dist/hash-password.js")"; then
      break
    fi
    warn "Try again"
  done
  unset PASSWORD_1 PASSWORD_2
  set_env HR_AUTO_PASSWORD_HASH "$HASH"
  echo "Team password saved (only its scrypt hash is stored)."
fi

step "Browser view (VNC) access"
if [[ "$ACCESS" == "public" ]]; then
  # Nginx only lets signed-in team members reach /vnc/, so no second password.
  printf 'HR_AUTO_VNC_AUTH=none\n' > "$CONFIG_DIR/vnc.env"
  echo "Protected by the team login (no separate VNC password)."
else
  printf 'HR_AUTO_VNC_AUTH=password\n' > "$CONFIG_DIR/vnc.env"
  if [[ ! -f "$CONFIG_DIR/vnc.pass" ]]; then
    # VNC passwords are limited to 8 characters. Generated in Python because
    # `tr </dev/urandom | head` dies of SIGPIPE under `set -o pipefail`.
    VNC_PASSWORD="$(python3 -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(8)))')"
    if command -v x11vnc >/dev/null 2>&1; then
      x11vnc -storepasswd "$VNC_PASSWORD" "$CONFIG_DIR/vnc.pass" >/dev/null 2>&1
    else
      printf '%s\n' "$VNC_PASSWORD" | vncpasswd -f > "$CONFIG_DIR/vnc.pass"
    fi
    printf '%s\n' "$VNC_PASSWORD" > "$CONFIG_DIR/vnc-password.txt"
    chmod 600 "$CONFIG_DIR/vnc-password.txt"
    echo "New VNC password created. Show it with: sudo cat $CONFIG_DIR/vnc-password.txt"
  else
    echo "VNC password already set"
  fi
  chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR/vnc.pass"
  chmod 600 "$CONFIG_DIR/vnc.pass"
fi
chmod 644 "$CONFIG_DIR/vnc.env"

# ---------------------------------------------------------------------------
step "Install and start systemd services"
for unit in "${SERVICES[@]}" hr-auto-backup; do
  install -m 644 "$DEPLOY_DIR/systemd/$unit.service" "/etc/systemd/system/$unit.service"
done
install -m 644 "$DEPLOY_DIR/systemd/hr-auto-backup.timer" /etc/systemd/system/hr-auto-backup.timer
systemctl daemon-reload
systemctl enable "${SERVICES[@]/%/.service}" hr-auto-backup.timer >/dev/null 2>&1
systemctl restart hr-auto-display hr-auto-wm hr-auto-vnc hr-auto-novnc
systemctl restart hr-auto
systemctl start hr-auto-backup.timer

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

# ---------------------------------------------------------------------------
install_nginx_site() { # install_nginx_site <template> <domain>
  install -m 644 "$DEPLOY_DIR/nginx/hr-auto-proxy.conf" /etc/nginx/snippets/hr-auto-proxy.conf
  sed "s/__PORT__/$PORT/g" "$DEPLOY_DIR/nginx/hr-auto-locations.conf" > /etc/nginx/snippets/hr-auto-locations.conf
  sed "s/__DOMAIN__/$2/g" "$DEPLOY_DIR/nginx/$1" > /etc/nginx/sites-available/hr-auto
  ln -sf /etc/nginx/sites-available/hr-auto /etc/nginx/sites-enabled/hr-auto
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx || systemctl restart nginx
}

if [[ "$ACCESS" == "lan" ]]; then
  step "Nginx (plain http on port 80, for testing)"
  install_nginx_site hr-auto-http.conf _
fi

if [[ "$ACCESS" == "public" ]]; then
  step "Check that $DOMAIN points to this server"
  PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)"
  DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
  echo "This server: ${PUBLIC_IP:-unknown}   $DOMAIN: ${DOMAIN_IP:-not found}"
  if [[ -z "$DOMAIN_IP" || "$DOMAIN_IP" != "$PUBLIC_IP" ]]; then
    warn "$DOMAIN does not point to this server yet."
    warn "Add a DNS record: type A, name = the part before your domain, value = ${PUBLIC_IP:-this server IP}"
    warn "(Cloudflare: set it to 'DNS only' / grey cloud), wait a few minutes, then run this installer again."
    exit 1
  fi

  step "Firewall: allow only SSH (rate limited), HTTP and HTTPS"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw limit OpenSSH >/dev/null
  ufw --force enable >/dev/null
  ufw status verbose | sed 's/^/  /'

  step "HTTPS certificate for $DOMAIN (Let's Encrypt)"
  mkdir -p "$ACME_ROOT"
  if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    echo "Let's Encrypt issues a free certificate. Their terms:"
    echo "  https://letsencrypt.org/repository/"
    if [[ "${HR_AUTO_LE_AGREE:-}" != "yes" ]]; then
      [[ "$(ask "Do you agree to the Let's Encrypt terms? (yes/no)" no)" == "yes" ]] || {
        echo "Cannot continue without a certificate." >&2
        exit 1
      }
    fi
    install_nginx_site hr-auto-acme.conf "$DOMAIN"
    certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
      --email "$LE_EMAIL" --agree-tos --no-eff-email --non-interactive
  else
    echo "Certificate already present"
  fi
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/hr-auto-reload-nginx.sh <<'EOF'
#!/bin/sh
# Installed by HR Auto: load renewed certificates.
systemctl reload nginx
EOF
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/hr-auto-reload-nginx.sh

  step "Nginx (HTTPS)"
  install_nginx_site hr-auto-https.conf "$DOMAIN"
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
IP_ADDRESS="$(hostname -I | awk '{print $1}')"
LOGIN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo USER)}"
echo
case "$ACCESS" in
  public)
    cat <<EOF
OK - HR Auto is live at  https://$DOMAIN
     Browser screen:     https://$DOMAIN/vnc/vnc.html  (same team login)

  - Share the address and the team password with your team (never the password in a group chat).
  - First time: Settings > Connect Facebook, then log in to Facebook on the browser screen.
  - Strongly recommended: use SSH keys and turn off SSH passwords (see docs/SERVER-EDITION-TH.md).
EOF
    ;;
  lan)
    cat <<EOF
OK - HR Auto (test mode, plain http) at  http://$IP_ADDRESS/
     Browser screen:                     http://$IP_ADDRESS/vnc/vnc.html
     VNC password: sudo cat $CONFIG_DIR/vnc-password.txt
EOF
    ;;
  tailscale)
    cat <<EOF
OK - HR Auto is running on 127.0.0.1:$PORT (not exposed to the network).
  Tailscale (phone, anywhere):  sudo bash deploy/ubuntu/tailscale-setup.sh
  SSH tunnel from a PC:         ssh -N -L 14173:127.0.0.1:$PORT -L 6080:127.0.0.1:6080 $LOGIN_USER@$IP_ADDRESS
  VNC password: sudo cat $CONFIG_DIR/vnc-password.txt
EOF
    ;;
esac
echo "Health check: sudo bash deploy/ubuntu/doctor.sh"
