#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  POSHIVE — Install Script
#  Usage: sudo bash install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[1;37m'; N='\033[0m'

say()  { echo -e "${G}✔${N}  $*"; }
warn() { echo -e "${Y}⚠${N}  $*"; }
die()  { echo -e "${R}✘${N}  $*" >&2; exit 1; }
ask()  { echo -e "${C}?${N}  $*"; }

echo -e "${W}"
echo "  ██████╗  ██████╗ ███████╗██╗  ██╗██╗██╗   ██╗███████╗"
echo "  ██╔══██╗██╔═══██╗██╔════╝██║  ██║██║██║   ██║██╔════╝"
echo "  ██████╔╝██║   ██║███████╗███████║██║██║   ██║█████╗  "
echo "  ██╔═══╝ ██║   ██║╚════██║██╔══██║██║╚██╗ ██╔╝██╔══╝  "
echo "  ██║     ╚██████╔╝███████║██║  ██║██║ ╚████╔╝ ███████╗"
echo "  ╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝"
echo -e "${N}"
echo -e "  Hive Blockchain POS — Setup Wizard\n"

# ── Root check ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  die "Please run as root:  sudo bash install.sh"
fi

# ── Dependency checks ─────────────────────────────────────────
echo -e "${B}── Checking dependencies ──────────────────────────────${N}"
for cmd in node npm git; do
  if command -v "$cmd" &>/dev/null; then
    say "$cmd found: $(command -v $cmd)"
  else
    die "$cmd not found. Please install it first."
  fi
done

NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null) || \
  die "Node.js 18+ required. Detected: $(node --version)"
say "Node.js $(node --version)"

if command -v systemctl &>/dev/null && systemctl --version &>/dev/null; then
  say "systemd found"
else
  die "systemd not found. This script requires a systemd-based Linux system."
fi
echo ""

# ── Resolve install directory ─────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

if [ ! -f "$BACKEND_DIR/server.js" ]; then
  die "Cannot find backend/server.js. Run this script from the POSHIVE root directory."
fi
say "Install directory: $SCRIPT_DIR"
echo ""

# ── Port scanner ──────────────────────────────────────────────
find_free_port() {
  local port=${1:-3001}
  while ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"; do
    port=$((port + 1))
  done
  echo "$port"
}

SUGGESTED_PORT=$(find_free_port 3001)

# ── Interactive prompts ───────────────────────────────────────
echo -e "${B}── Configuration ───────────────────────────────────────${N}"

ask "Service port? [${SUGGESTED_PORT}]"
read -r INPUT_PORT
PORT="${INPUT_PORT:-$SUGGESTED_PORT}"
say "Port: $PORT"

ask "Public URL (used for image links, no trailing slash)? [https://pos.3speak.tv]"
read -r INPUT_URL
PUBLIC_URL="${INPUT_URL:-https://pos.3speak.tv}"
say "Public URL: $PUBLIC_URL"

ask "MongoDB URI? [mongodb://localhost:27017/poshive]"
read -r INPUT_MONGO
MONGODB_URI="${INPUT_MONGO:-mongodb://localhost:27017/poshive}"
say "MongoDB URI set"

ask "Superadmin Hive username? (this account gets full admin access)"
read -r SUPERADMIN_USERNAME
while [ -z "$SUPERADMIN_USERNAME" ]; do
  warn "Superadmin username cannot be empty."
  ask "Superadmin Hive username?"
  read -r SUPERADMIN_USERNAME
done
say "Superadmin: $SUPERADMIN_USERNAME"

ask "CORS origin? (use * to allow all, or your domain) [*]"
read -r INPUT_CORS
CORS_ORIGIN="${INPUT_CORS:-*}"
say "CORS: $CORS_ORIGIN"

echo ""
echo -e "${B}── JWT ─────────────────────────────────────────────────${N}"
GENERATED_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
ask "JWT secret? [press Enter to generate a secure random one]"
read -r INPUT_JWT
JWT_SECRET="${INPUT_JWT:-$GENERATED_SECRET}"
if [ -z "$INPUT_JWT" ]; then
  say "JWT secret generated (64 random hex chars)"
else
  say "JWT secret set"
fi

ask "JWT expiry? [7d]"
read -r INPUT_EXPIRY
JWT_EXPIRY="${INPUT_EXPIRY:-7d}"

echo ""
echo -e "${B}── Email / SMTP (optional — press Enter to skip) ───────${N}"
ask "SMTP host? (e.g. smtp.resend.com)"
read -r EMAIL_HOST

if [ -n "$EMAIL_HOST" ]; then
  ask "SMTP port? [465]"
  read -r INPUT_EMAIL_PORT
  EMAIL_PORT="${INPUT_EMAIL_PORT:-465}"

  ask "SMTP secure (true/false)? [true]"
  read -r INPUT_EMAIL_SECURE
  EMAIL_SECURE="${INPUT_EMAIL_SECURE:-true}"

  ask "SMTP user?"
  read -r EMAIL_USER

  ask "SMTP password?"
  read -rsp "  > " EMAIL_PASS; echo ""

  ask "From address? (e.g. billing@yourdomain.com)"
  read -r EMAIL_FROM

  say "SMTP configured"
else
  EMAIL_PORT="465"
  EMAIL_SECURE="true"
  EMAIL_USER=""
  EMAIL_PASS=""
  EMAIL_FROM=""
  warn "SMTP skipped — email reminders will not work until configured in .env"
fi

echo ""
echo -e "${B}── System user ─────────────────────────────────────────${N}"
CURRENT_USER=$(logname 2>/dev/null || echo "${SUDO_USER:-www-data}")
ask "Run service as which user? [$CURRENT_USER]"
read -r INPUT_USER
RUN_AS="${INPUT_USER:-$CURRENT_USER}"
if ! id "$RUN_AS" &>/dev/null; then
  die "User '$RUN_AS' does not exist. Create it first or choose another."
fi
say "Service user: $RUN_AS"

echo ""

# ── Write .env ────────────────────────────────────────────────
echo -e "${B}── Writing .env ────────────────────────────────────────${N}"
ENV_FILE="$BACKEND_DIR/.env"

cat > "$ENV_FILE" <<EOF
# Server
PORT=$PORT

# MongoDB
MONGODB_URI=$MONGODB_URI
MONGODB_DB_NAME=poshive

# JWT
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=$JWT_EXPIRY

# CORS
CORS_ORIGIN=$CORS_ORIGIN

# Superadmin
SUPERADMIN_USERNAME=$SUPERADMIN_USERNAME

# Public URL
PUBLIC_URL=$PUBLIC_URL

# Email / SMTP
EMAIL_HOST=$EMAIL_HOST
EMAIL_PORT=$EMAIL_PORT
EMAIL_SECURE=$EMAIL_SECURE
EMAIL_USER=$EMAIL_USER
EMAIL_PASS=$EMAIL_PASS
EMAIL_FROM=$EMAIL_FROM
EOF

chmod 600 "$ENV_FILE"
chown "$RUN_AS" "$ENV_FILE"
say ".env written to $ENV_FILE"

# ── npm install ───────────────────────────────────────────────
echo ""
echo -e "${B}── Installing dependencies ─────────────────────────────${N}"
cd "$BACKEND_DIR"
sudo -u "$RUN_AS" npm install --omit=dev
say "npm install complete"

# ── npm run build (if script exists) ─────────────────────────
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)" 2>/dev/null; then
  echo ""
  echo -e "${B}── Building ─────────────────────────────────────────────${N}"
  sudo -u "$RUN_AS" npm run build
  say "Build complete"
fi

# ── Systemd service ───────────────────────────────────────────
echo ""
echo -e "${B}── Creating systemd service ────────────────────────────${N}"
SERVICE_FILE="/etc/systemd/system/poshive.service"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=POSHIVE Backend API
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=$RUN_AS
WorkingDirectory=$BACKEND_DIR
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$ENV_FILE

# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable poshive
systemctl restart poshive

sleep 2
if systemctl is-active --quiet poshive; then
  say "poshive.service is running"
else
  warn "Service may not have started. Check logs: journalctl -u poshive -n 50"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${W}─────────────────────────────────────────────────────────${N}"
echo -e "${G}  POSHIVE installed successfully!${N}"
echo -e "${W}─────────────────────────────────────────────────────────${N}"
echo ""
echo -e "  Backend running on:  ${C}http://localhost:${PORT}${N}"
echo -e "  Public URL:          ${C}${PUBLIC_URL}${N}"
echo -e "  Superadmin account:  ${C}${SUPERADMIN_USERNAME}${N}"
echo ""
echo -e "  Useful commands:"
echo -e "    ${Y}systemctl status poshive${N}     — check service status"
echo -e "    ${Y}journalctl -u poshive -f${N}      — follow logs"
echo -e "    ${Y}systemctl restart poshive${N}     — restart service"
echo -e "    ${Y}bash update.sh${N}                — pull updates"
echo ""
echo -e "  Next steps:"
echo -e "    1. Point DNS: ${C}${PUBLIC_URL#https://}${N} → this server"
echo -e "    2. Set up nginx:  ${Y}docs/nginx.conf${N}"
echo -e "    3. Get SSL cert:  ${Y}certbot --nginx -d ${PUBLIC_URL#https://}${N}"
echo ""
