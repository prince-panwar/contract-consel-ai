#!/usr/bin/env bash
# Deploy embed-server to your Oracle Cloud box.
#
# Usage:
#   SSH_KEY=~/.ssh/oracle.pem SSH_HOST=ubuntu@1.2.3.4 ./scripts/deploy.sh
#
# Or set these as env vars in your shell once and just run ./scripts/deploy.sh.
#
# What it does:
#   1. rsyncs this directory (minus node_modules / dist / .env) to ~/embed-server on the box
#   2. ensures docker + swap exist on the box
#   3. builds and (re)starts the Docker container via docker compose
#   4. tails the logs until /health responds, then exits
#
# Idempotent — safe to re-run after every code change.

set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/webmob/workspace/ssh-key-mail.key}"
SSH_HOST="${SSH_HOST:-ubuntu@161.118.177.76}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/embed-server}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[deploy] $LOCAL_DIR  →  $SSH_HOST:$REMOTE_DIR"

if [ ! -f "$SSH_KEY" ]; then
  echo "[deploy] SSH key not found at $SSH_KEY" >&2
  exit 1
fi
chmod 600 "$SSH_KEY" 2>/dev/null || true

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

echo "[deploy] ensure .env exists on box (generate one if missing)..."
ssh_cmd "bash -s" <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  RANDOM_KEY=\$(openssl rand -hex 32)
  sed -i "s|^API_KEY=.*|API_KEY=\$RANDOM_KEY|" .env
  echo "[remote] generated new API_KEY in .env"
fi
echo "[remote] .env API_KEY=\$(grep ^API_KEY= .env | cut -d= -f2)"
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
echo "Also confirm Oracle VCN ingress allows TCP ${PORT} from 0.0.0.0/0."
echo "=========================================="
