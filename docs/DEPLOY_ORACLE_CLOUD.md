# Deploy IAC Asset Management on Oracle Cloud

This guide deploys the project to one Oracle Cloud Infrastructure (OCI) Ubuntu VM using the production Docker Compose stack. Caddy provides HTTPS, PostgreSQL stores the application data, and separate containers run the web app, API and email worker.

> **A domain is required for this production setup.** You need a domain or subdomain you control, such as `assets.example.org`, with a DNS record pointing to the OCI VM. The production stack uses that exact hostname for secure cookies and automatic HTTPS. A temporary `trycloudflare.com` URL is not a substitute for a stable production domain.
>
> If you do not have one, ask your organization’s domain administrator to create a subdomain for the portal before starting the production deployment. Do not enter a made-up hostname; Caddy will not be able to obtain a trusted certificate for it.

## What you need

- An OCI account and a region where you can create a Compute VM.
- A domain or subdomain you control and access to its DNS settings.
- The project code available from a private Git repository (recommended) or another secure transfer method.
- A Windows computer with PowerShell and OpenSSH to create an SSH key and connect to the VM.
- An approved SMTP sender and credentials. This is required for invitations and other email notifications.
- A password manager or other approved secret store for the VM secrets and backups.

OCI's current Always Free documentation lists Ampere A1 resources equivalent to up to 2 OCPUs and 12 GB of memory, subject to tenancy quotas and capacity in the home region. Availability and charges can change, so confirm the **Always Free eligible** label and estimated cost in the OCI Console before creating resources. An A1 VM is ARM64; this project's Docker images use Node, PostgreSQL, nginx and Caddy images that support ARM64. See [OCI Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [OCI instance creation](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm).

## 1. Prepare the code on your Windows computer

Open PowerShell in the project folder:

```powershell
cd E:\Projects\IAC-Asset-Management-System-main\IAC-Asset-Management-System-main
git status
git remote -v
```

Use a **private** Git repository. If this project is not in a remote repository yet, create a private repository with your Git provider, add it as `origin`, and push the reviewed code. For GitHub, for example:

```powershell
git remote add origin git@github.com:YOUR-ACCOUNT/YOUR-PRIVATE-REPOSITORY.git
git add -A
git commit -m "Prepare Oracle Cloud deployment"
git push -u origin main
```

If `origin` already exists, do not add it again; verify that it is the correct private repository and push your branch. Review `git status` before committing. Never commit `.env`, `.env.production`, SMTP passwords, database passwords, VAPID private keys, or encryption keys. These files are intended to stay on the server and are gitignored by the project.

## 2. Create an SSH key for OCI

In PowerShell:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\oci_iac" -C "iac-oracle-cloud"
Get-Content "$env:USERPROFILE\.ssh\oci_iac.pub"
```

Set a passphrase when prompted. Copy the **public** key printed by the second command. Keep `oci_iac` (the private key) on your computer; never upload or send it.

## 3. Create the OCI network and VM

In the [OCI Console](https://cloud.oracle.com/):

1. Select your **home region**. The Always Free A1 allowance is tied to the tenancy's home region, and A1 capacity may be temporarily unavailable.
2. Open **Compute → Instances → Create instance**.
3. Name it `iac-assets-prod` and select **Ubuntu 24.04** (64-bit). Choose `VM.Standard.A1.Flex` if it is available and marked Always Free eligible. For this app, start with up to **2 OCPUs and 12 GB memory**, within the free allowance shown by OCI. If A1 is out of capacity, wait or choose another eligible shape after checking its price and resources.
4. Create a new VCN and **public subnet** using the launch wizard, or select an existing public subnet with an internet gateway and an internet route. Assign a public IPv4 address.
5. Upload the public SSH key from step 2 (paste the contents of `oci_iac.pub`).
6. Choose an adequately sized boot volume (for example, 50 GB if within your account's free storage quota). Leave the default boot volume backup setting if it meets your needs; it does not replace database backups.
7. Create the instance. Wait until its state is **Running**, then copy its public IPv4 address.
8. For a stable DNS target, assign a **reserved public IP** to the instance's primary private IP. OCI describes reserved IPs as persistent across instance termination/reassignment; check the Console for current pricing before reserving. See [OCI public IP addresses](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm) and [creating a reserved public IP](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/reserved-public-ip-create.htm).

### Allow only the required inbound ports

On the VM's Network Security Group (preferred) or the public subnet's security list, add stateful ingress rules:

| Protocol | Destination port | Source |
|---|---:|---|
| TCP | 22 (SSH) | Your current public IP address with `/32`, for example `203.0.113.25/32` |
| TCP | 80 (HTTP; Caddy certificate/redirect) | `0.0.0.0/0` |
| TCP | 443 (HTTPS) | `0.0.0.0/0` |

Do **not** open ports `3000`, `5173`, `5432`, or `55432`. The Compose file does not publish these ports. Restrict SSH to your IP rather than opening it to everyone. OCI recommends limiting SSH ingress to authorized source CIDRs; see [OCI networking security](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/networking_security.htm).

## 4. Point your domain at the VM

At the DNS provider for your domain, add an `A` record:

| Type | Name | Value |
|---|---|---|
| A | `assets` (or your chosen subdomain) | The VM's reserved public IPv4 address |

For example, the resulting hostname might be `assets.indiaautismcenter.org`. Use a subdomain your organization authorizes. Do not include `https://` in the DNS value or in the `DOMAIN` setting below. Remove or correct any stale `AAAA` record if the VM is not configured for IPv6.

Wait for DNS to resolve to the OCI address before deploying. On Windows, check with:

```powershell
Resolve-DnsName assets.example.org
```

Replace `assets.example.org` with your actual hostname. Caddy needs inbound port 80 or 443 and correct DNS to request and renew its HTTPS certificate automatically. If you use Cloudflare DNS, start with the record set to **DNS only** until HTTPS works; you can enable the proxy afterwards and set Cloudflare SSL/TLS mode to **Full (strict)**.

## 5. Connect to the VM

From PowerShell, replace the address with the VM's public IPv4 address:

```powershell
ssh -i "$env:USERPROFILE\.ssh\oci_iac" ubuntu@203.0.113.10
```

The Ubuntu image's default login name is `ubuntu`. Accept the host fingerprint only if this is the instance you just created. If SSH times out, check the public IP and the OCI ingress rule for TCP 22; if your ISP address changed, update the `/32` source.

## 6. Install Docker Engine and Compose on Ubuntu

Run these commands **in the SSH session on the VM**. They use Docker's official Ubuntu package repository, which supports both AMD64 and ARM64 Ubuntu. See [Docker's Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Keep using `sudo docker ...` in the commands below. Adding a user to the `docker` group grants root-equivalent control over the host.

### Configure the Ubuntu host firewall

The OCI network rules are the main public ingress control. Docker-published ports can bypass ordinary UFW rules, so never publish an internal app or database port and do not rely on UFW alone to protect Docker ports. Docker documents this firewall interaction in its [Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).

After confirming the OCI SSH rule allows your current IP, allow SSH, HTTP and HTTPS on the VM:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

## 7. Give the VM read-only access to your private repository

If your repository is public, skip this section. For a private GitHub repository, create a read-only deploy key on the VM:

```bash
ssh-keygen -t ed25519 -C "oci-iac-readonly" -f ~/.ssh/iac_deploy -N ""
cat ~/.ssh/iac_deploy.pub
```

In GitHub, open the private repository's **Settings → Deploy keys → Add deploy key**. Add the displayed public key and leave **Allow write access** unchecked. The private key stays on the VM and should only be used to read this repository.

Clone the repository, replacing the URL and folder name as needed:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/iac_deploy -o IdentitiesOnly=yes' \
  git clone git@github.com:YOUR-ACCOUNT/YOUR-PRIVATE-REPOSITORY.git ~/iac-assets
cd ~/iac-assets
```

If you use a different Git provider, follow its equivalent instructions for a read-only deploy key. Do not put a personal access token in the clone URL or shell history.

## 8. Create the production settings file

From the repository root on the VM:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Replace every example or `GENERATE_...` value. Do not leave template placeholders in place. Required settings include:

| Setting | What to enter |
|---|---|
| `DOMAIN` | Your exact hostname, such as `assets.example.org`, without a scheme or trailing slash |
| `ACME_EMAIL` | An email address monitored by your team for certificate notices |
| `POSTGRES_OWNER_PASSWORD` | A unique 64-character hex value from `openssl rand -hex 32` |
| `POSTGRES_APP_PASSWORD` | A different unique value from `openssl rand -hex 32` |
| `TOTP_ENCRYPTION_KEY` | A unique value from `openssl rand -hex 32` |
| `AUTH_MAIL_ENCRYPTION_KEY` | A different unique value from `openssl rand -hex 32` |
| `CSRF_SECRET` | A different unique value from `openssl rand -hex 32` |
| `SMTP_*` | Your approved provider's host, port, TLS mode, credentials and sender |
| `PUSH_VAPID_PUBLIC_KEY` | Production VAPID public key |
| `PUSH_VAPID_PRIVATE_KEY` | Matching production VAPID private key |
| `PUSH_VAPID_SUBJECT` | A monitored contact such as `mailto:it@example.org` |

Generate each database/encryption/CSRF secret separately. Run this command once per value and enter each output directly in your private settings file:

```bash
openssl rand -hex 32
```

Generate a VAPID pair once from your development computer at the project root, where dependencies are installed:

```powershell
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Copy the matching `publicKey` and `privateKey` to `.env.production` using a secure method. Keep the private key secret and keep the **same pair** across deployments. Changing it requires every device to refresh its push subscription. Do not paste keys into chat or commit them to Git.

For SMTP, use your organization's approved sender. The template uses port 465 with TLS. OCI blocks outbound TCP port 25 by default for many tenancies; use a submission port supported by your provider, normally 465 or 587, rather than port 25. See [OCI's outbound SMTP note](https://docs.oracle.com/en-us/iaas/Content/Network/Troubleshoot/vcn_troubleshooting.htm).

### Optional: OCI Email Delivery for invitations

You can use OCI Email Delivery instead of Gmail or another SMTP provider. In OCI, configure Email Delivery for the sending region, configure SPF and DKIM for your sending domain, create an approved sender, and generate SMTP credentials. Oracle's approved sender is region-specific, and the `From` address must be approved. Use the SMTP endpoint shown under **Email Delivery → Configuration** and TLS on port 465. Enter the endpoint, generated SMTP username/password and approved `SMTP_FROM` in `.env.production`. See Oracle's [Email Delivery getting started guide](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted.htm), [SMTP connection settings](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted_topic-Configure_the_SMTP_connection.htm), and [approved senders](https://docs.oracle.com/en-us/iaas/Content/Email/Reference/gettingstarted_topic-Create_an_approved_sender.htm).

Save and exit nano with **Ctrl+O**, **Enter**, **Ctrl+X**. Confirm the file is private and excluded from Git:

```bash
chmod 600 .env.production
git status --short
```

`git status` should not list `.env.production`.

## 9. Start the production application

Check the Compose configuration, then build and start the stack:

```bash
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml config -q
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
```

On first startup, PostgreSQL initializes its persistent volume. The `migrate` and `grants` jobs apply schema updates and restricted runtime permissions; they should complete successfully before the API and worker become healthy.

Inspect status and logs:

```bash
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps -a
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs --tail=100 migrate grants api worker caddy
```

`migrate` and `grants` showing **Exited (0)** is expected after a successful run. Check that `api`, `worker`, `web`, `db` and `caddy` are running. Test the health endpoint:

```bash
curl -fsS https://assets.example.org/api/v1/health
```

Replace the hostname with your real one. Then open `https://assets.example.org` in a browser. Caddy may need a short time to obtain the first TLS certificate. Do not proceed with staff invitations until the site opens over HTTPS and the API is healthy.

## 10. Create the first administrator

Run the interactive bootstrap once, from the project root on the VM:

```bash
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml run --rm api node apps/api/dist/cli.js bootstrap
```

Enter the administrator's approved work email, name and a strong unique password when prompted. The password is entered interactively; do not put it in the command. Sign in at the HTTPS URL, enroll an authenticator, save the recovery codes in an approved safe place, and complete the portal notice.

## 11. Verify the app before inviting staff

1. Confirm the dashboard and asset catalog load over HTTPS.
2. Create a test employee invitation using an inbox you can access. Check the inbox and spam folder; confirm that the invitation link opens the deployed hostname, not `localhost` or `127.0.0.1`.
3. Check email worker errors if it does not arrive:

   ```bash
   sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml logs --tail=100 worker
   ```

4. On a phone, open the HTTPS site, use **Install app**, and enable notifications on that device. Send a test announcement to confirm Web Push works. Push subscriptions are per browser/device.
5. Scan a test asset QR from a phone and confirm its public asset details match your intended privacy policy.
6. Only then invite the rest of the staff.

## 12. Back up the database

The production Compose stack stores PostgreSQL data in the persistent Docker volume `iac_pg`. `docker compose down` does not delete it; **never use `down -v`** on a live installation. A VM or boot-volume backup alone is not a tested database backup.

Create a custom-format database dump on the VM:

```bash
mkdir -p ~/iac-backups
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml exec -T db \
  pg_dump -U iac_owner -Fc iac > ~/iac-backups/iac-$(date +%F-%H%M).dump
ls -lh ~/iac-backups
```

Copy the dump to encrypted storage outside the VM and verify it is readable. From a separate PowerShell window on your computer, for example:

```powershell
scp -i "$env:USERPROFILE\.ssh\oci_iac" ubuntu@203.0.113.10:/home/ubuntu/iac-backups/iac-YYYY-MM-DD-HHMM.dump .
```

Replace the IP and exact dump filename. Store `.env.production` secrets separately from the database dump; losing the encryption keys prevents recovery of encrypted MFA, queued email and push-subscription data. Preserve VAPID keys to keep existing device subscriptions valid. Before go-live, test restoring a backup into a separate, isolated database or VM. Do not restore over the live database without a reviewed recovery plan.

## 13. Apply future updates

First make and push a reviewed release from your development computer. Then connect to the VM and run:

```bash
cd ~/iac-assets
GIT_SSH_COMMAND='ssh -i ~/.ssh/iac_deploy -o IdentitiesOnly=yes' git pull --ff-only
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml exec -T db \
  pg_dump -U iac_owner -Fc iac > ~/iac-backups/iac-before-update-$(date +%F-%H%M).dump
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml up -d --build
sudo docker compose --env-file .env.production -f infra/docker-compose.prod.yml ps -a
```

Review the migration and API logs after each update. The deployment command reuses the existing database volume. Never delete the volume to fix a migration problem.

## Troubleshooting

| Symptom | Check |
|---|---|
| Cannot SSH | VM is running; use `ubuntu` and the matching private key; OCI TCP 22 ingress includes your current IP `/32`. |
| Website times out | VM has a public IP and public-subnet internet route; OCI allows TCP 80/443; Docker has started Caddy. |
| Caddy reports certificate/ACME errors | `DOMAIN` is only a hostname; its A record points at the reserved IP; ports 80/443 reach the VM; `ACME_EMAIL` is valid. Review Caddy logs. |
| Compose says `DOMAIN` is required | Edit `.env.production` in the repository root and set `DOMAIN=assets.example.org` with your actual hostname. |
| Invitation email does not arrive | Review worker logs and SMTP settings; use a verified sender and valid credentials; use TLS on port 465/587, not port 25. Also check spam and your provider's suppression/bounce console. |
| Push reports HTTP 401/403 | Keep the production VAPID pair stable. After correcting it, users must refresh their device's notification subscription in the app. |
| App is unavailable after reboot | Check `sudo systemctl status docker` and Compose service state. Services use `restart: unless-stopped`; start the stack with the normal `up -d` command if needed. |
| Disk is filling | Check `df -h` and Docker logs/images. Backups and database growth need monitoring; do not prune volumes or run `docker compose down -v`. |

## Network and cost notes

- The app is public on TCP 80/443. SSH is limited to your IP. PostgreSQL and the API are not directly published to the internet.
- The VM must stay running for the portal, invitation worker, and notifications to work. Quick Tunnel testing on your PC is not an always-on deployment.
- Always Free eligibility depends on current tenancy quotas, region and available capacity. Review the OCI cost estimate for compute, boot/block storage, reserved IPs, backups and any paid resources before confirming. A small single VM is suitable for a controlled pilot, not high availability; production-grade continuity requires independent backups and a tested recovery plan.

## Official references

- [OCI Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Create an OCI Compute instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm)
- [OCI public IP addresses](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm)
- [OCI networking security](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/networking_security.htm)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Project single-server deployment guide](DEPLOY_SINGLE_SERVER.md)
- [Project production operations guidance](PRODUCTION.md)
