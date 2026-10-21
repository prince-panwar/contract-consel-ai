# syntax=docker/dockerfile:1.7
# Next.js app as a long-running Node server (standalone output). Extraction
# runs as an in-process background job, so this must not be serverless.

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:20-slim AS runtime
# Serif fonts for PDF export: Liberation (Times-compatible) + DejaVu fallback
# for glyphs Liberation lacks (₹, non-Latin scripts).
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
        fonts-liberation2 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=1536
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1:3000/login || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
