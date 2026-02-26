#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — PostgreSQL database backup for production
#
# Usage:
#   ./scripts/backup-db.sh
#
# Environment variables (all optional, shown with defaults):
#   BACKUP_DIR       ./data/backups
#   RETENTION_DAYS   30
#   COMPOSE_FILE     docker-compose.prod.yml
#
# Recommended cron (every 6 hours):
#   0 */6 * * * cd /path/to/project && bash scripts/backup-db.sh >> data/logs/backup.log 2>&1
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backtesting_${TIMESTAMP}.sql.gz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup → ${BACKUP_FILE}"

# Dump the database from the running postgres container, pipe through gzip
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U backtesting backtesting | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup created: ${BACKUP_FILE} (${SIZE})"

# Remove backups older than RETENTION_DAYS
DELETED=$(find "$BACKUP_DIR" -name 'backtesting_*.sql.gz' -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done."
