#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Stop this application's web container to take a consistent metadata/database snapshot; image bytes remain in R2.
docker compose -p hooboo stop web
trap 'docker compose -p hooboo start web >/dev/null' EXIT
volume=$(docker volume ls --filter label=com.docker.compose.project=hooboo --filter label=com.docker.compose.volume=gallery_data --format '{{.Name}}')
test -n "$volume"
docker run --rm --user 1001:1001 --entrypoint tar -v "$volume:/data:ro" -v "$PWD/backups:/backup" hooboo-web -czf "/backup/gallery-$stamp.tgz" -C /data .
chmod 600 "backups/gallery-$stamp.tgz"
cp .env.production "backups/env-$stamp"
chmod 600 "backups/env-$stamp"
echo "Backup saved: backups/gallery-$stamp.tgz"
