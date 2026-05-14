# syntax=docker/dockerfile:1.7
#
# Multi-stage build for embed-server.
# Targets the Oracle Always Free AMD VM (E2.1.Micro, x86_64, 1 GB RAM).
#
# We use node:20-slim (Debian, glibc) because @xenova/transformers pulls in
# onnxruntime-node, which ships glibc-linked native binaries that don't run
# on Alpine (musl).

ARG NODE_VERSION=20

# ---- Builder stage ----------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript.
RUN npm run build

# Pre-download the embedding model so the runtime image starts instantly
# instead of pulling ~90 MB on first request. Force the cache to a known
# directory so the runtime stage can copy it deterministically.
ENV TRANSFORMERS_CACHE=/opt/model-cache
RUN mkdir -p $TRANSFORMERS_CACHE && \
    node -e "const t=require('@xenova/transformers'); t.env.cacheDir='/opt/model-cache'; t.pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2').then(()=>console.log('model cached'))"

# Drop devDependencies for the runtime copy.
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev


# ---- Runtime stage ----------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

# Tini for clean signal handling under PID 1.
RUN apt-get update && apt-get install -y --no-install-recommends tini curl && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN useradd --create-home --shell /bin/bash --uid 10001 app

WORKDIR /app

# Heap sized for the Ampere A1 target. ONNX native allocations are OUTSIDE
# this number; the container memory limit in docker-compose is the real ceiling.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=2048 \
    TRANSFORMERS_CACHE=/opt/model-cache \
    HOST=0.0.0.0

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

# Bring the warmed model cache over.
COPY --from=builder --chown=app:app /opt/model-cache /opt/model-cache

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT:-3000}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
