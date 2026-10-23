# Production operations

Production is a separate release gate. This local implementation must pass the checks recorded in REVIEW.md and VERIFICATION.md. Configure organization-approved sender, recipient groups, domain, region and retention. Never load the original workbook directly into employee-facing data; staging/reconciliation is required.

Use an immutable API image (infra/Dockerfile target api) and web image (target web). API and worker share the release; override worker command to its compiled entry point. Run reviewed migrations with separate schema-owner credentials before starting the runtime role. Use an external TLS load balancer and private PostgreSQL; web proxy /api goes to api:3000. The original incoming protocol must be preserved by the TLS proxy. Set correct trusted proxy hops and exact APP_ORIGIN. Secure cookies cannot be tested on an HTTP production origin.

Do not deploy compose.local.yml: it is localhost-only infrastructure. Use runtime credentials that cannot ALTER tables or DELETE assets/history; REVOKE UPDATE/DELETE on audit/events/ticket updates/email attempts. Account for the explicitly mutable session/token/outbox tables. Use encrypted backups, managed PITR and a tested restore procedure. Run a controlled migration account separately.

Monitor readiness, worker heartbeat, oldest pending delivery, dead letters and error rates. SMTP acceptance is not proof of inbox delivery. Use approved verified sender and per-recipient messages. Keep auth-email encryption and TOTP keys in a secret manager, separate from database backups. Rotate via a tested re-encryption/migration procedure, never by silently changing the key.

Before launch: MFA for staff, role/IDOR review, dependency/container scan, sender SPF/DKIM/DMARC setup, restored-backup verification, load test, approved employee mappings, cutover reconciliation and signed operational ownership. Financial reports remain pending Finance method/residual policy. Daily signed audit exports to external immutable storage are an operational integration and must be configured before a tamper-evidence claim.

Rollback images only across compatible expand/contract schemas. Never run destructive down migrations automatically. After live writes, preserve custody, ticket, audit and outbox delta before any restore; suppress outbound email during restore. No automatic fallback to a stale workbook.

Apply infra/runtime-grants.sql on the dedicated app database using its migration owner. It creates a NOLOGIN role; provision a login separately through managed secrets. API/worker must use that restricted role and migrations must use the separate owner. The permission boundaries are checked by a PostgreSQL integration test.


Master Control upgrade: apply migration 004 with the migration owner, then reapply infra/runtime-grants.sql. The runtime needs INSERT/UPDATE on departments and locations as well as reference_values. Existing records and stable codes are retained; do not recreate or truncate the database to upgrade.

Single-server Docker Compose + Caddy deployment: see [DEPLOY_SINGLE_SERVER.md](DEPLOY_SINGLE_SERVER.md) and `infra/docker-compose.prod.yml`.
