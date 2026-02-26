# Production Deployment Guide

This guide covers deploying the backtesting platform to a VDS (Virtual Dedicated Server) using Docker Compose.

## Architecture

```
Internet → Nginx (:80) → api container (:3000) → postgres container (:5432)
```

- **Nginx**: Reverse proxy, serves the React SPA, handles SSE for paper-trading streams.
- **api**: Node.js / Fastify backend (managed by PM2 inside the container).
- **postgres**: PostgreSQL 16 database (data persisted in a named Docker volume).

---

## Prerequisites

- Docker >= 24 with the Compose plugin (`docker compose` — no hyphen)
- Git
- A server running Linux (Ubuntu 22.04 LTS recommended)
- At least 1 GB RAM, 10 GB disk

Install Docker on Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in after this
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/backtesting.git
cd backtesting
```

---

## 2. Configure Environment

```bash
cp .env.prod.example .env
```

Open `.env` and set **at minimum**:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password for the database |
| `DATABASE_URL` | Must use the same password as `POSTGRES_PASSWORD` |
| `PUBLIC_PORT` | Port nginx listens on (80 or 443) |

Optional:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for trade alerts |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID |
| `LOG_LEVEL` | `info` (default), `debug`, `warn`, `error` |

Generate a strong password:

```bash
openssl rand -hex 32
```

---

## 3. Build and Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes (npm install + TypeScript compile + Vite build).
Subsequent deployments are faster due to Docker layer caching.

Check that everything came up:

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output — all services should show `running` or `healthy`:

```
NAME                 STATUS
backtesting-api-1    running
backtesting-nginx-1  running
backtesting-postgres-1  healthy
```

---

## 4. Verify the Deployment

```bash
# Health check (from the server)
curl http://localhost/api/health

# Expected response
{"status":"ok","timestamp":"...","version":"1.0.0"}
```

Open `http://<your-server-ip>/` in a browser — the React dashboard should load.

---

## 5. Monitoring

### Container logs

```bash
# All services (follow)
docker compose -f docker-compose.prod.yml logs -f

# API only
docker compose -f docker-compose.prod.yml logs -f api

# Nginx only
docker compose -f docker-compose.prod.yml logs -f nginx
```

### PM2 logs (inside the api container)

```bash
docker compose -f docker-compose.prod.yml exec api pm2 logs
docker compose -f docker-compose.prod.yml exec api pm2 status
```

### Structured log files (persisted via Docker volume)

```bash
docker compose -f docker-compose.prod.yml exec api cat /app/data/logs/api-out.log
docker compose -f docker-compose.prod.yml exec api cat /app/data/logs/api-error.log
```

---

## 6. Set Up Automated Backups

Make the script executable (already done if cloned fresh):

```bash
chmod +x scripts/backup-db.sh
```

Add a cron job to back up every 6 hours:

```bash
crontab -e
```

Add this line (adjust the path to your project directory):

```cron
0 */6 * * * cd /home/deploy/backtesting && bash scripts/backup-db.sh >> data/logs/backup.log 2>&1
```

Backups are written to `data/backups/` and kept for 30 days by default. Override with:

```bash
BACKUP_DIR=/mnt/nas/backups RETENTION_DAYS=90 bash scripts/backup-db.sh
```

### Restore from backup

```bash
# Copy a backup into the postgres container and restore
BACKUP_FILE=data/backups/backtesting_20260226_120000.sql.gz

gunzip -c "$BACKUP_FILE" | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U backtesting backtesting
```

---

## 7. Updating the Application

```bash
git pull

# Rebuild and restart (zero downtime is not guaranteed during rebuild)
docker compose -f docker-compose.prod.yml up -d --build

# Verify
curl http://localhost/api/health
```

Database migrations run automatically on startup via `initDb()`.

---

## 8. SSL with Let's Encrypt (Optional)

Install certbot:

```bash
sudo apt install certbot python3-certbot-nginx
```

Obtain a certificate (replace `example.com`):

```bash
sudo certbot --nginx -d example.com
```

Then update `nginx.conf` to listen on 443 and redirect 80 → 443, and set `PUBLIC_PORT=443` in `.env`. Certbot auto-renews via a systemd timer.

---

## 9. Paper Trading

Create your first paper-trading session via the REST API:

```bash
curl -s -X POST http://localhost/api/paper-trading/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My First Paper Session",
    "strategy": "funding-rate-spike",
    "symbol": "ATOM/USDT:USDT",
    "timeframe": "4h",
    "initialCapital": 10000
  }' | jq .
```

Start the session:

```bash
SESSION_ID="<id from above>"
curl -s -X POST http://localhost/api/paper-trading/sessions/$SESSION_ID/start | jq .
```

Paper trading engines persist across API restarts because PM2 automatically restarts the process and the session state is stored in PostgreSQL.

---

## 10. Troubleshooting

**Port 80 already in use**

```bash
sudo lsof -i :80
# If Apache/Nginx is already running on the host, either stop it or change PUBLIC_PORT
```

**Database connection refused**

```bash
# Check postgres is healthy
docker compose -f docker-compose.prod.yml ps postgres
# Check logs
docker compose -f docker-compose.prod.yml logs postgres
```

**API crashes on startup**

```bash
docker compose -f docker-compose.prod.yml logs api
# Check PM2
docker compose -f docker-compose.prod.yml exec api pm2 logs --nostream
```

**Out of disk space**

```bash
# Clean unused Docker images
docker image prune -f
# Clean old backups
find data/backups -name '*.sql.gz' -mtime +30 -delete
```
