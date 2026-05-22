#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  POSHIVE — Update Script
#  Usage: bash update.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
say()  { echo -e "${G}✔${N}  $*"; }
warn() { echo -e "${Y}⚠${N}  $*"; }
die()  { echo -e "${R}✘${N}  $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo -e "${C}POSHIVE updater${N}"
echo ""

# ── Pull latest code ──────────────────────────────────────────
cd "$SCRIPT_DIR"
say "Pulling latest changes..."
git pull

# ── Install / update dependencies ────────────────────────────
say "Installing dependencies..."
cd "$BACKEND_DIR"
npm install --omit=dev

# ── Build (if script exists) ──────────────────────────────────
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)" 2>/dev/null; then
  say "Running build..."
  npm run build
fi

# ── Restart service ───────────────────────────────────────────
if systemctl is-active --quiet poshive 2>/dev/null; then
  say "Restarting poshive service..."
  sudo systemctl restart poshive
  sleep 2
  if systemctl is-active --quiet poshive; then
    say "Service restarted successfully"
  else
    warn "Service may not have started. Check: journalctl -u poshive -n 50"
  fi
else
  warn "poshive service is not running. Start it with: sudo systemctl start poshive"
fi

echo ""
say "Update complete!"
