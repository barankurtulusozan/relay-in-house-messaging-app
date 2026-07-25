#!/usr/bin/env bash
set -euo pipefail

# Nightly logical PostgreSQL backup script
BACKUP_DIR="/var/backups/chatapp/postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/chatapp_${TIMESTAMP}.dump"
GPG_RECIPIENT="${GPG_RECIPIENT:-backup@yourcompany.com}"
SECONDARY_HOST="${SECONDARY_HOST:-secondary-vps.yourcompany.com}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting logical dump of Postgres database..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "${POSTGRES_HOST:-localhost}" -U "${POSTGRES_USER:-chatapp}" -Fc chatapp > "${BACKUP_FILE}"

echo "[$(date)] Encrypting backup with GPG..."
gpg --trust-model always --encrypt --recipient "${GPG_RECIPIENT}" "${BACKUP_FILE}"

echo "[$(date)] Transferring encrypted backup to secondary VPS standby (${SECONDARY_HOST})..."
rsync -avz -e ssh "${BACKUP_FILE}.gpg" "backup@${SECONDARY_HOST}:/var/backups/chatapp/postgres/"

# Clean local dumps older than 14 days
find "${BACKUP_DIR}" -type f -name "*.dump.gpg" -mtime +14 -delete

echo "[$(date)] Backup completed successfully."
