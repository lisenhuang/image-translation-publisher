FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN groupadd -g 1001 gallery && useradd -u 1001 -g gallery gallery && mkdir -p /data && chown -R gallery:gallery /data /app
COPY --from=build --chown=gallery:gallery /app/.next/standalone ./
COPY --from=build --chown=gallery:gallery /app/.next/static ./.next/static
COPY --from=build --chown=gallery:gallery /app/public ./public
COPY --chown=gallery:gallery scripts/storage-status.mjs ./scripts/storage-status.mjs
USER gallery
EXPOSE 3000
CMD ["node","server.js"]
