# Single-server deployment (Docker Compose + Caddy)

`infra/docker-compose.prod.yml` runs the whole platform on one Linux server: Caddy terminates HTTPS (automatic Let's Encrypt certificate), sends `/api/*` straight to the API and everything else to the web container. PostgreSQL runs in a container with a persistent volume. Read [PRODUCTION.md](PRODUCTION.md) for the release gate; this file covers only the mechanics.

| Service | Role |
|---|---|
| `caddy` | Public ports 80/443, HTTPS, reverse proxy |
| `web` | nginx serving the built React app |
| `api` | NestJS API, restricted `iac_app` database login |
| `worker` | Email outbox dispatcher (SMTP) |
| `db` | PostgreSQL 17, volume `iac_pg` |
| `migrate`, `grants` | One-shot jobs on every `up`: pending migrations as owner, then `runtime-grants.sql` |

## First deployment

1. Server: Ubuntu 24.04 (or similar), 2 GB RAM, Docker Engine with the Compose plugin. Open ports 80 and 443 only. Check that the provider allows outbound SMTP on your chosen port (465/587).
2. DNS: point an A record (e.g. `assets.indiaautismcenter.org`) at the server's public IP before starting, so Caddy can obtain a certificate.
3. Copy the project to the server, then create the private settings file:

   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

   Fill every value. Generate each secret separately with `openssl rand -hex 32`.
   For PWA push, generate one VAPID pair from the project root with
   `node -e "console.log(require('web-push').generateVAPIDKeys())"`, then save the
   `publicKey` and `privateKey` as `PUSH_VAPID_PUBLIC_KEY` and
   `PUSH_VAPID_PRIVATE_KEY`. Set `PUSH_VAPID_SUBJECT` to a monitored
   `mailto:it@example.org` address. Keep this key pair stable across releases.

4. Start everything:

   ```bash
   docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
   ```

   On first start the `db` init script creates the `iac_runtime` role and the `iac_app` login. `migrate` and `grants` then run and exit; `api` and `worker` start only if both succeed. Check with `docker compose ... ps` and `docker compose ... logs migrate grants api`.

5. Create the first Admin (interactive, hidden password prompt):

   ```bash
   docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api node apps/api/dist/cli.js bootstrap
   ```

6. Open `https://<DOMAIN>`, sign in, enroll MFA and accept the portal notice.

After sign-in, users can open **Install app** for device-specific steps and enable
notifications on each device. On iPhone/iPad, add the site to the Home Screen and open
the installed app before enabling push. **PWA announcements** is available to Admin and
IT Admin roles and sends to devices that have enabled notifications.

## Email

The worker starts with the stack and sends every eligible pending notification. Fill the `SMTP_*` values before the first `up`, or remove `worker` from the command (`up -d caddy web api`) until outbound delivery is approved. For Google Workspace use `smtp.gmail.com`, port `465`, `SMTP_SECURE=true`, the full sender address and a Google app password (see [GMAIL_SMTP.md](GMAIL_SMTP.md)). Configure SPF, DKIM and DMARC for the sender domain.

After changing `.env.production`, apply it with the same `up -d` command; only changed services are recreated.

## Updates

Copy the new release and rerun the `up -d --build` command. Migrations and grants are reapplied automatically before the new API starts. Take a database backup first.

## Backups

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml exec -T db pg_dump -U iac_owner -Fc iac > iac-$(date +%F).dump
```

Schedule this daily (cron), copy dumps off the server and encrypt them. Store `.env.production` keys separately from backups; without `TOTP_ENCRYPTION_KEY` and `AUTH_MAIL_ENCRYPTION_KEY` a restored database cannot decrypt MFA, queued email, or saved push subscriptions. Preserve the VAPID pair so existing subscriptions remain valid. Test a restore before go-live. A managed PostgreSQL (with point-in-time recovery) can replace the `db` service: point `DATABASE_URL`/`MIGRATION_DATABASE_URL` at it, set `DATABASE_SSL=true`, and create the `iac_runtime` role and `iac_app` login there as in `infra/postgres-init/01-runtime-login.sh`.

## Notes

- The database password for `iac_app` is applied only when the `iac_pg` volume is first created. To rotate it later, run `ALTER ROLE iac_app PASSWORD '...'` as `iac_owner`, then update `.env.production`.
- Use hex secrets for both database passwords; they are embedded in connection URLs.
- Do not expose PostgreSQL; the compose file publishes no database port.
