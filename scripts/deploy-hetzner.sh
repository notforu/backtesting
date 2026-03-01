#!/usr/bin/env bash
# Hetzner VDS Deployment Script for Backtesting Platform
# Run this on a fresh Ubuntu 24.04 server
set -euo pipefail

echo "================================================"
echo "  Backtesting Platform - Hetzner Deploy Script"
echo "================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root (sudo bash scripts/deploy-hetzner.sh)${NC}"
  exit 1
fi

# Step 1: System updates
echo -e "${YELLOW}[1/6] Updating system...${NC}"
apt-get update -qq && apt-get upgrade -y -qq

# Step 2: Install Docker
if command -v docker &> /dev/null; then
  echo -e "${GREEN}[2/6] Docker already installed, skipping...${NC}"
else
  echo -e "${YELLOW}[2/6] Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# Verify Docker Compose is available (comes with Docker now)
if ! docker compose version &> /dev/null; then
  echo -e "${RED}Docker Compose not found. Please install Docker Compose v2.${NC}"
  exit 1
fi

# Step 3: Firewall setup
echo -e "${YELLOW}[3/6] Configuring firewall...${NC}"
apt-get install -y -qq ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw --force enable
echo -e "${GREEN}Firewall configured: SSH (22) and HTTP (80) allowed${NC}"

# Step 4: Create .env.prod if it doesn't exist
if [ ! -f .env.prod ]; then
  echo -e "${YELLOW}[4/6] Creating .env.prod...${NC}"

  # Generate a random password for Postgres
  PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

  cat > .env.prod << EOF
# Production environment variables
# Generated on $(date)

# PostgreSQL
POSTGRES_PASSWORD=${PG_PASSWORD}

# Logging
LOG_LEVEL=info

# Public port (80 = standard HTTP)
PUBLIC_PORT=80

# Optional: Telegram alerts
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
EOF

  chmod 600 .env.prod
  echo -e "${GREEN}.env.prod created with random Postgres password${NC}"
else
  echo -e "${GREEN}[4/6] .env.prod already exists, skipping...${NC}"
fi

# Step 5: Build and deploy
echo -e "${YELLOW}[5/6] Building and deploying (this may take a few minutes)...${NC}"
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# Step 6: Wait for health check
echo -e "${YELLOW}[6/6] Waiting for services to be healthy...${NC}"
MAX_WAIT=60
WAITED=0
until curl -sf http://localhost/health > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}Services did not become healthy within ${MAX_WAIT}s${NC}"
    echo "Check logs with: docker compose -f docker-compose.prod.yml logs"
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
  echo -n "."
done
echo ""

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  Dashboard:   ${GREEN}http://${SERVER_IP}${NC}"
echo -e "  Health:      ${GREEN}http://${SERVER_IP}/health${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "    View logs:     docker compose -f docker-compose.prod.yml logs -f"
echo -e "    Restart:       docker compose -f docker-compose.prod.yml restart"
echo -e "    Stop:          docker compose -f docker-compose.prod.yml down"
echo -e "    Rebuild:       docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"
echo -e "    Update:        git pull && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"
echo ""
echo -e "  ${YELLOW}Postgres password saved in .env.prod (keep this file safe!)${NC}"
echo ""
