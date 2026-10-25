#!/usr/bin/env bash
# Creates .env.production on the server. Secrets are generated here and never leave the server.
# Usage (from the project folder on the server): bash scripts/setup-production-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.production ]; then
  echo ".env.production already exists - not overwriting it."
  exit 1
fi

read -r -p "Domain (e.g. assets.indiaautismcenter.org or 13-233-45-67.sslip.io): " DOMAIN
read -r -p "Sender email (e.g. it@indiaautismcenter.org): " MAIL
read -r -s -p "Google app password (typing is hidden): " SMTPPW
echo

secret() { openssl rand -hex 32; }

umask 077
cat > .env.production <<ENV
DOMAIN=${DOMAIN}
ACME_EMAIL=${MAIL}
POSTGRES_OWNER_PASSWORD=$(secret)
POSTGRES_APP_PASSWORD=$(secret)
TOTP_ENCRYPTION_KEY=$(secret)
AUTH_MAIL_ENCRYPTION_KEY=$(secret)
CSRF_SECRET=$(secret)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=${MAIL}
SMTP_PASSWORD=${SMTPPW// /}
SMTP_FROM=IAC Asset Portal <${MAIL}>
PORTAL_NOTICE_VERSION=1
ENV

echo
echo "Created .env.production"
echo "Save these keys in a password manager now (losing TOTP_ENCRYPTION_KEY breaks MFA logins):"
echo "--------------------------------------------------------------------------------"
grep -E "PASSWORD|KEY|SECRET" .env.production | grep -v "^SMTP_PASSWORD"
echo "--------------------------------------------------------------------------------"
echo "Next: docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build"
