# Deploy to AWS Lightsail (step by step)

This runs the whole platform (website, API, email worker, PostgreSQL and automatic HTTPS) on one Lightsail server, using `infra/docker-compose.prod.yml`. Allow about 45 minutes the first time.

## 0. Before you start
- **Web address.** Either:
  - **A. Your own subdomain**, e.g. `assets.indiaautismcenter.org`. You need someone who can edit that domain's DNS.
  - **B. No DNS access yet (pilot):** use a free `sslip.io` name built from the server IP, e.g. `13-233-45-67.sslip.io`. HTTPS still works. Switch to A later; any QR labels printed before the switch must be reprinted.
- **Email.** A sender mailbox (e.g. `it@indiaautismcenter.org`) and a **fresh** Google app password: Google Account → Security → 2-Step Verification → App passwords.
- **Keys.** A password manager to store the secret keys you generate in step 5.

## 1. Create the server
1. Go to **lightsail.aws.amazon.com** and click **Create instance**.
2. **Region:** Mumbai (`ap-south-1`).
3. **Platform:** Linux/Unix → **OS Only** → **Ubuntu 24.04 LTS**.
4. **Plan:** **$12 (2 GB RAM, 2 vCPU, 60 GB SSD)**. The $24 / 4 GB plan builds faster and leaves more headroom.
5. **Name:** `iac-assets` → **Create instance**. Wait until it shows **Running**.

## 2. Static IP and firewall
1. Open the instance → **Networking** tab.
2. Click **Attach static IP** → create one → attach it. Note the IP, e.g. `13.233.45.67`.
3. Under **IPv4 Firewall**, keep `SSH 22` and add **`HTTP 80`** and **`HTTPS 443`**.
4. **DNS (option A):** add an **A record** for `assets` pointing to the static IP. With option B there's nothing to do.

## 3. Prepare the server
Click **Connect using SSH**; a browser terminal opens. Run each block:

```bash
sudo apt-get update && sudo apt-get -y upgrade
```

Add 2 GB of swap, so the build doesn't run out of memory on the 2 GB plan:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu
```

Then **close the SSH window and open it again**, so the docker group applies, and check:

```bash
docker compose version
```

## 4. Put the code on the server
**Option 1: private GitHub repository (best for updates).**
1. Push the project from your PC to a **private** repo.
2. On the server, run:

```bash
git clone https://github.com/<you>/<repo>.git iac && cd iac
```

**Option 2: upload a zip.**
1. On your PC, zip the project folder **without** `node_modules`, `dist`, `test-results`, `.env` or `.superpowers`.
2. In the Lightsail browser SSH window, use the **⋮ menu → Upload file** and pick the zip.
3. On the server, run:

```bash
sudo apt-get -y install unzip && unzip <name>.zip -d iac && cd iac
```

If the files ended up in a subfolder, `cd` into the folder that contains `package.json`.

## 5. Production settings

```bash
cp .env.production.example .env.production && chmod 600 .env.production
```

Generate the five secrets. Run this five times and copy each result:

```bash
openssl rand -hex 32
```

Open the file:

```bash
nano .env.production
```

Fill in every value:

| Setting | Value |
|---|---|
| `DOMAIN` | `assets.indiaautismcenter.org`, or `13-233-45-67.sslip.io` (your IP with dashes) |
| `ACME_EMAIL` | `it@indiaautismcenter.org`, for certificate expiry notices |
| `POSTGRES_OWNER_PASSWORD` | secret 1 |
| `POSTGRES_APP_PASSWORD` | secret 2 |
| `TOTP_ENCRYPTION_KEY` | secret 3 |
| `AUTH_MAIL_ENCRYPTION_KEY` | secret 4 |
| `CSRF_SECRET` | secret 5 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.gmail.com` / `465` / `true` |
| `SMTP_USER` | `it@indiaautismcenter.org` |
| `SMTP_PASSWORD` | the new Google app password |
| `SMTP_FROM` | `IAC Asset Portal <it@indiaautismcenter.org>` |

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`. **Copy all five secrets into your password manager now.** Losing `TOTP_ENCRYPTION_KEY` locks everyone out of MFA.

## 6. Start everything

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
```

The first build takes 5–15 minutes. It builds the app, creates the database, runs every migration (001–009), applies the restricted database permissions, then starts the API, email worker, website and Caddy. Caddy gets the HTTPS certificate automatically.

Check that everything is running:

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps
```

`api`, `worker`, `web`, `db` and `caddy` should be **running**. `migrate` and `grants` should be **exited (0)**.

## 7. Create the first admin

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api node apps/api/dist/cli.js bootstrap
```

Enter your email, name and a password of 12+ characters. Then open **`https://<DOMAIN>`**, sign in, set up the authenticator app, **save the recovery codes** and accept the portal notice.

## 8. Test end to end
1. People & access: invite yourself on a second email and check the invitation arrives.
2. Create an asset, then print a QR label from **Print labels** (40-up small stickers by default).
3. Scan the label with your phone camera. It should open the asset page; sign in and raise a ticket with a photo.
4. On the phone, try the in-app **Scan** button and **Install app**. Both work over HTTPS.

## 9. Everyday operations
Start every session with:

```bash
cd ~/iac
```

**View logs** (if something fails):

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs --tail 100 api worker caddy
```

**Update to a new version** (take a backup first):

```bash
git pull && docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
```

With a zip, upload and unzip the new version over the folder instead of `git pull`, keeping `.env.production`.

**Database backup:**

```bash
docker compose --env-file .env.production -f infra/docker-compose.prod.yml exec -T db pg_dump -U iac_owner -Fc iac > ~/iac-$(date +%F).dump
```

**Server backup:** Lightsail → instance → **Snapshots** → enable **automatic snapshots** (a few dollars a month).

**Costs:** Billing → Budgets → create a **$10 monthly budget** with an email alert.

## 10. If something goes wrong

| Symptom | Fix |
|---|---|
| Browser shows a certificate error | DNS isn't pointing at the static IP yet, or ports 80/443 aren't open. Wait 10 minutes after the DNS change, then check `logs caddy`. |
| "Request origin is not allowed" | You're using an address other than `https://<DOMAIN>`. Always use exactly that one. |
| Build stops with "Killed" | Out of memory. Make sure the swap from step 3 is on (`free -h`), or use the 4 GB plan. |
| No emails arrive | Check `logs worker`. Check the app password and `SMTP_*` values; after editing `.env.production`, rerun the step 6 command. |
| `api` keeps restarting | Check `logs api migrate grants`. Usually a typo in `.env.production`. |

## 11. Moving from sslip.io to the real domain
1. Add the DNS **A record** for `assets.indiaautismcenter.org`.
2. Change `DOMAIN` in `.env.production`.
3. Rerun the step 6 command.
4. Users sign in again at the new address.
5. **Reprint** any QR labels made with the old address.

**Credits:** before your AWS credits end, upgrade the account to a paid plan, or move to an IAC-owned account by copying `.env.production`, restoring the latest `pg_dump`, and running steps 3–6 there.
