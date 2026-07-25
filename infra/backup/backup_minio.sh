#!/usr/bin/env bash
set -euo pipefail

# Nightly MinIO attachment object storage sync script
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_BUCKET="${MINIO_BUCKET:-chat-attachments}"
SECONDARY_HOST="${SECONDARY_HOST:-secondary-vps.yourcompany.com}"

echo "[$(date)] Mirroring MinIO attachments bucket to secondary VPS..."
mc alias set localminio "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"
mc mirror --overwrite localminio/"${MINIO_BUCKET}" "ssh://${SECONDARY_HOST}/var/backups/chatapp/minio/"

echo "[$(date)] MinIO mirror completed successfully."
