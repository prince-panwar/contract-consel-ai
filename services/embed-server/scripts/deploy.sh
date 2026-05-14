#!/usr/bin/env bash
# Deploy embed-server to your Oracle Cloud box.
#
# Usage:
#   SSH_KEY=~/.ssh/oracle.pem SSH_HOST=ubuntu@1.2.3.4 ./scripts/deploy.sh
#
# Or just `./scripts/deploy.sh` to use the defaults baked in below
# (ubuntu@161.118.177.76 + /home/webmob/workspace/ssh-key-mail.key).
#
# What it does:
#   1. reads MONGODB_URI / MONGODB_DB from the Next.js app's .env.local
#      (../../.env.local relative to this script) so embed-server uses the
#      same database as Vercel without you having to duplicate secrets
#   2. rsyncs services/embed-server to ~/embed-server on the box (excluding
#      node_modules, dist, .env)
#   3. ensures docker + swap exist on the box
#   4. writes the remote .env: existing API_KEY preserved (random one
#      generated on first run), MONGODB_URI / MONGODB_DB always synced from
#      .env.local on every run
#   5. docker compose up -d --build
#   6. polls /health until it answers
#
# Idempotent — safe to re-run after every code or env change.

set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/webmob/workspace/ssh-key-mail.key}"
SSH_HOST="${SSH_HOST:-ubuntu@161.118.177.76}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/embed-server}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Default to the repo root's .env.local (services/embed-server/../../.env.local).
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$LOCAL_DIR/../../.env.local}"

echo "[deploy] $LOCAL_DIR  →  $SSH_HOST:$REMOTE_DIR"

if [ ! -f "$SSH_KEY" ]; then
  echo "[deploy] SSH key not found at $SSH_KEY" >&2
  exit 1
fi
chmod 600 "$SSH_KEY" 2>/dev/null || true

if [ ! -f "$LOCAL_ENV_FILE" ]; then
  echo "[deploy] .env.local not found at $LOCAL_ENV_FILE" >&2
  echo "[deploy] set LOCAL_ENV_FILE=/path/to/.env.local to override." >&2
  exit 1
fi

# Pull just the two keys we care about. Strip surrounding quotes if any.
# Errors out cleanly if a key is missing so we don't silently deploy with empty Mongo creds.
extract_env() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$LOCAL_ENV_FILE" | head -n1 | cut -d= -f2- || true)
  # Strip optional surrounding quotes.
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  if [ -z "$val" ]; then
    echo "[deploy] $key is missing or empty in $LOCAL_ENV_FILE" >&2
    exit 1
  fi
  printf '%s' "$val"
}

MONGODB_URI_VALUE=$(extract_env MONGODB_URI)
MONGODB_DB_VALUE=$(extract_env MONGODB_DB)
# Base64 the values to dodge any shell-escape pitfalls during the ssh hop.
MONGODB_URI_B64=$(printf '%s' "$MONGODB_URI_VALUE" | base64 -w0)
MONGODB_DB_B64=$(printf '%s' "$MONGODB_DB_VALUE" | base64 -w0)

ssh_cmd() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_HOST" "$@"
}

echo "[deploy] rsync source to box..."
rsync -avz --delete \
  --exclude node_modules --exclude dist --exclude .env --exclude .git --exclude '*.log' \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$LOCAL_DIR/" "$SSH_HOST:$REMOTE_DIR/"

echo "[deploy] bootstrap host (docker + swap if missing)..."
ssh_cmd "bash -s" <<'REMOTE'
set -euo pipefail
if ! command -v docker >/dev/null; then
  echo "[remote] installing docker..."
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
fi
if ! swapon --show | grep -q .; then
  echo "[remote] creating 2 GB swap..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
REMOTE

echo "[deploy] sync .env (API_KEY preserved, Mongo creds from local .env.local)..."
ssh_cmd "MONGODB_URI_B64='$MONGODB_URI_B64' MONGODB_DB_B64='$MONGODB_DB_B64' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

# First run: seed .env from the template + new API_KEY.
if [ ! -f .env ]; then
  cp .env.example .env
  RANDOM_KEY=$(openssl rand -hex 32)
  # macOS-safe sed flag would be different; box is Ubuntu so -i is fine.
  sed -i "s|^API_KEY=.*|API_KEY=$RANDOM_KEY|" .env
  echo "[remote] generated new API_KEY in .env"
fi

# Always overwrite Mongo creds from what the laptop sent.
URI=$(printf '%s' "$MONGODB_URI_B64" | base64 -d)
DB=$(printf '%s' "$MONGODB_DB_B64" | base64 -d)

# Drop any existing MONGODB_URI / MONGODB_DB lines, then append fresh ones.
grep -v '^MONGODB_URI=' .env | grep -v '^MONGODB_DB=' > .env.tmp
{
  cat .env.tmp
  printf 'MONGODB_URI=%s\n' "$URI"
  printf 'MONGODB_DB=%s\n' "$DB"
} > .env
rm -f .env.tmp
chmod 600 .env

echo "[remote] .env API_KEY=$(grep ^API_KEY= .env | cut -d= -f2)"
echo "[remote] .env MONGODB_DB=$(grep ^MONGODB_DB= .env | cut -d= -f2)"
echo "[remote] .env MONGODB_URI=$(grep ^MONGODB_URI= .env | cut -d= -f2 | sed -E 's|://[^@]+@|://***@|')"
REMOTE

echo "[deploy] build + restart container..."
ssh_cmd "cd $REMOTE_DIR && sudo docker compose up -d --build"

echo "[deploy] waiting for /health..."
PORT=$(ssh_cmd "grep ^PORT= $REMOTE_DIR/.env | cut -d= -f2" || echo 3000)
PORT="${PORT:-3000}"
for i in $(seq 1 60); do
  if ssh_cmd "curl -sf http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "[deploy] ready after ${i}s"
    ssh_cmd "curl -s http://127.0.0.1:$PORT/health"
    echo
    break
  fi
  sleep 2
done

API_KEY=$(ssh_cmd "grep ^API_KEY= $REMOTE_DIR/.env | cut -d= -f2")
PUBLIC_IP=$(echo "$SSH_HOST" | cut -d@ -f2)

echo
echo "=========================================="
echo "DONE. Set these in Vercel project settings:"
echo "  EMBED_SERVICE_URL=http://${PUBLIC_IP}:${PORT}"
echo "  EMBED_SERVICE_API_KEY=${API_KEY}"
echo
echo "Mongo creds were synced from $LOCAL_ENV_FILE"
echo "Also confirm Oracle VCN ingress allows TCP ${PORT} from 0.0.0.0/0."
echo "=========================================="
