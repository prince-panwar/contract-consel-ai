# embed-server

Self-hosted embeddings + PDF parsing for `contract-counsel-ai`.

The Vercel-deployed Next.js app calls this service for the two operations that don't fit in serverless:

- `POST /embed` — `{ texts: string[] }` → `{ vectors: number[][] }` (384-dim, MiniLM)
- `POST /parse-pdf` — multipart `file` → `{ pages: [{ pageNumber, text }], fullText }`

Designed to run on an Oracle Cloud Always Free **AMD VM.Standard.E2.1.Micro** (1 OCPU / 1 GB RAM / x86_64). Steady-state memory is ~600 MB; transient spikes during a PDF parse can hit ~900 MB. A 2 GB swap file is required.

## Endpoints

All endpoints except `/health` require the `x-api-key` header (matches `API_KEY` env var).

| Method | Path         | Body                                  | Response                                              |
|--------|--------------|---------------------------------------|-------------------------------------------------------|
| GET    | `/health`    | —                                     | `{ ok: true, model }`                                 |
| POST   | `/embed`     | `{ "texts": ["...", "..."] }` (JSON)  | `{ "vectors": [[...384 floats], ...] }`               |
| POST   | `/parse-pdf` | `multipart/form-data` with `file`     | `{ "pages": [{pageNumber,text}], "fullText": "..." }` |

## Local dev

```bash
cp .env.example .env
# set API_KEY to anything for local testing
npm install
npm run dev           # tsx watch
# in another shell:
curl -s -X POST http://localhost:3000/embed \
  -H "x-api-key: $(grep ^API_KEY .env | cut -d= -f2)" \
  -H "content-type: application/json" \
  -d '{"texts":["hello world","second chunk"]}' | jq '.vectors | length, .vectors[0] | length'
# expect: 2, 384
```

---

## Quick deploy (one command)

For the existing Oracle box (replace `SSH_KEY` and `SSH_HOST` with your values; defaults match the laptop's `mail-automation` setup):

```bash
SSH_KEY=/home/webmob/workspace/ssh-key-mail.key \
SSH_HOST=ubuntu@161.118.177.76 \
./scripts/deploy.sh
```

The script:
1. rsyncs `services/embed-server/` to `/home/ubuntu/embed-server/` on the box,
2. installs Docker + a 2 GB swap file if they're missing,
3. generates a random `API_KEY` into `.env` on first run (kept across re-runs),
4. runs `docker compose up -d --build`,
5. waits for `/health`, then prints the `EMBED_SERVICE_URL` + `EMBED_SERVICE_API_KEY` values to paste into Vercel.

**Before the first run** — stop whatever's already on the box (see the next section for how to inspect). Then come back and run the script.

The longer manual walkthrough is below if you need to deviate from defaults.

---

## Deploy to Oracle (Docker — recommended)

### A. Inspect & clear the box

The Oracle box currently runs a `mail-automation` service in `/home/ubuntu/mail-automation/`. We'll stop it, archive it, and put embed-server in its place.

SSH in using your PEM:

```bash
ssh -i /home/webmob/workspace/ssh-key-mail.key ubuntu@161.118.177.76
```

Then on the box:

```bash
# What's listening on ports?
sudo ss -tulpn

# Anything in Docker?
docker ps -a 2>/dev/null
docker compose ls 2>/dev/null

# Anything under systemd?
systemctl list-units --type=service --state=running --no-pager

# Anything in PM2?
pm2 list 2>/dev/null

# Anything currently bound to port 3000?
sudo lsof -i :3000 2>/dev/null || sudo fuser 3000/tcp 2>/dev/null
```

Stop whatever's there:

```bash
# If Docker:
docker compose -f <old-compose-file>.yml down            # if compose
docker stop <container> && docker rm <container>         # if plain run
docker image prune -a                                    # free disk if tight

# If systemd:
sudo systemctl stop <old-service>
sudo systemctl disable <old-service>

# If PM2:
pm2 stop all && pm2 delete all && pm2 save
```

Move the old code out of the way (don't delete until you've confirmed the new one works):

```bash
mv /home/ubuntu/mail-automation /home/ubuntu/mail-automation.bak
```

### B. Install Docker (if not already there)

```bash
# Ubuntu:
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect.

# Oracle Linux 8/9:
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

### C. Add a swap file (essential on 1 GB)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && \
  sudo mkswap /swapfile && sudo swapon /swapfile && \
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### D. Get the code onto the box

Option 1 — git pull (easiest if your repo is reachable):

```bash
git clone <your-repo-url> ~/contract-counsel-ai
cd ~/contract-counsel-ai/services/embed-server
```

Option 2 — scp from your laptop (no git access needed):

```bash
# From your laptop, in the repo root:
rsync -avz --exclude node_modules --exclude dist \
  -e "ssh -i path/to/key.pem" \
  services/embed-server/ ubuntu@<oracle-public-ip>:~/embed-server/
ssh -i path/to/key.pem ubuntu@<oracle-public-ip>
cd ~/embed-server
```

### E. Configure secrets

```bash
cp .env.example .env
# Edit .env and replace API_KEY with a fresh secret:
sed -i "s|^API_KEY=.*|API_KEY=$(openssl rand -hex 32)|" .env
cat .env       # confirm
```

> ⚠️ `.env.example` ships with a placeholder key. **Don't reuse it.** Generate a fresh one with `openssl rand -hex 32` and keep it out of git.

### F. Build & run

```bash
docker compose up -d --build
docker compose logs -f embed-server
# expect:
#   Pre-loading embedding model...
#   Model loaded.
#   embed-server listening on :3000 (max concurrency 1)
```

First build downloads + pre-warms the model (~90 MB) into the image, so subsequent restarts are instant. The build takes ~3–5 minutes on E2.1.Micro.

### G. Port

Port `3000` is already open on this box (it was the mail-automation port), so there's nothing to do here. If you ever need to confirm:

- Oracle VCN: Networking → VCN → Security Lists → Default → ingress for TCP `3000` from `0.0.0.0/0` should already exist.
- Host firewall: `sudo iptables -L INPUT -n | grep 3000` (Ubuntu) or `sudo firewall-cmd --list-ports` (Oracle Linux).

### H. Verify from your laptop

```bash
curl -s http://<oracle-public-ip>:3000/health
# {"ok":true,"model":"Xenova/all-MiniLM-L6-v2"}

curl -s -X POST http://<oracle-public-ip>:3000/embed \
  -H "x-api-key: <your-API_KEY>" \
  -H "content-type: application/json" \
  -d '{"texts":["sanity check"]}' | head -c 200
```

### I. Wire Vercel to the service

In Vercel → Project → Settings → Environment Variables, add:

```
EMBED_SERVICE_URL=http://<oracle-public-ip>:3000
EMBED_SERVICE_API_KEY=<the same API_KEY>
```

Then redeploy. Drop the stale 768-dim Gemini embeddings in MongoDB:
```js
db.reports.updateMany({}, { $unset: { embeddingsB64: "", chunks: "" } })
```

## Updating the service

```bash
cd ~/contract-counsel-ai          # or ~/embed-server if you scp'd
git pull                          # (skip if you scp instead — rsync again)
cd services/embed-server
docker compose up -d --build
docker compose logs -f embed-server
```

## Useful operational commands

```bash
docker compose ps                      # container state
docker compose logs --tail=200         # recent logs
docker stats embed-server              # live CPU/RAM (Ctrl-C to exit)
free -h                                # swap usage
docker compose restart embed-server
docker compose down                    # stop + remove container
docker compose down -v --rmi all       # full nuke (free disk)
```

## ⚠️ HTTP, not HTTPS

The configuration above exposes a plain HTTP endpoint on the Oracle public IP. That means:

- The `x-api-key` header is sent **in cleartext** on every request.
- Uploaded PDF contents and embedding payloads (potentially sensitive contract excerpts) traverse the public internet **unencrypted**.

This is acceptable for an early MVP. **Before storing real user data, switch to HTTPS.** Simplest upgrade:

- Point a free subdomain (DuckDNS / no-IP / your own) at the Oracle IP.
- Add Caddy as a sidecar container in `docker-compose.yml` that proxies `:443 → embed-server:3000` and auto-issues Let's Encrypt certs.
- Update `EMBED_SERVICE_URL` to `https://embed.example.com` on Vercel.
- Close port 3000 in the Oracle VCN, open 80 + 443 instead.

Or run `cloudflared` as a sidecar for a Cloudflare Tunnel — automatic HTTPS, no public port at all.

---

## Alternative: deploy without Docker (systemd)

If you'd rather not run Docker, the older systemd flow still works. See `systemd/embed-server.service` and the steps below.

```bash
# Swap (same as Docker path).
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && \
  sudo mkswap /swapfile && sudo swapon /swapfile && \
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node 20.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Code.
git clone <your-repo-url> ~/contract-counsel-ai
cd ~/contract-counsel-ai/services/embed-server
npm ci && npm run build

# Env + warm-up.
cp .env.example .env   # then set a real API_KEY
npm run prewarm

# systemd.
sudo cp systemd/embed-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now embed-server
sudo journalctl -u embed-server -f
```

Then open the port the same way as the Docker path.

## Operational notes

- `MAX_CONCURRENCY=1` (env, default) means one job at a time. On a bigger box raise to 2–4.
- Docker image's `NODE_OPTIONS=--max-old-space-size=700` caps V8 heap; adjust if you resize the VM.
- Logs are capped to 30 MB per container via the `logging` block in `docker-compose.yml`.
- If you see repeated container restarts and `OOMKilled: true` under `docker inspect embed-server`, raise the swap file size — building/parsing peaks above the 850 MB container cap.
