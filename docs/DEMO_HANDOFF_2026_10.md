# IAC manager demo handoff

Start with [Run the manager demo locally](RUN_DEMO_FIRST.md) for prerequisites, exact setup, first login and access limits.

Implementation checkpoint: 28 October 2026, Asia/Calcutta. This is a single-organization improvement branch, not a production SaaS certification. The full product blueprint remains the release roadmap.

## Demo path

1. Admin opens People & equipment, searches an employee and sees their current items together. Choose Assign another item, search an available mouse, open its assignment, verify the named recipient and click Use this person for this item before confirming. Existing laptop custody stays unchanged. Repeat for a keyboard. Every item keeps its asset ID and custody history.
2. Employee opens My equipment. Only their own current items appear, with individual receipt and issue-report actions. Closed assignments remain on the item history.
3. Admin opens Finance review, selects an asset and submits the current version with a reason. A separate Finance user can return it with a reason or approve invoice/cost details. Submitter/reviewer separation and version conflicts are checked on the server. Later amendments preserve the last approved snapshot until approval.
4. Executive opens the read-only overview. Approved acquisition cost is not book value or depreciation. Coverage, pending reviews and unsubmitted assets explain gaps in totals. Department summary is bounded to 25 groups, not a full ledger report.
5. Admin opens Email delivery. Inspect pending/retry/dead-letter states and safe attempt codes. SMTP acceptance is not inbox delivery. No tokens, message bodies or encrypted payloads appear; there is no blind resend button.
6. Notifications supports server-side unread filtering and pagination. Older unread notices remain reachable beyond the latest 100.

## Permission boundaries

ADMIN owns registration and custody changes in the existing application. IT_ADMIN remains a support role; it did not gain new custody rights. FINANCE reviews cost/invoice fields and can inspect person-linked financial state, but cannot assign/return items. EXECUTIVE gets aggregate read-only information. EMPLOYEE sees only their own equipment and their authorized tickets. New privileged roles require MFA. Company policies, approval thresholds, depreciation, SLAs and tenant boundaries are not silently invented.

## Running safely

Use Node 24, PostgreSQL and the repository's existing setup instructions. Apply migrations 017 and 018 after the existing migrations, then reapply infra/runtime-grants.sql to the dedicated runtime role. Migration 018 blocks update/delete on Finance evidence. Run with generated local test settings and local fake SMTP only. Do not copy test credentials to production or enable real outbound delivery without approval.

Commands:

```sh
npm ci
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
CI=1 npm run test:e2e
```

Integration/browser tests require TEST_DATABASE_URL ending in `_test`, fake SMTP on localhost:11025 and the browser executable supplied by CI or Playwright. PLAYWRIGHT_CHROME_EXECUTABLE can select an installed Chrome binary; otherwise existing CI/Edge defaults remain. Browser service workers are blocked for test isolation, so the suite does not certify offline/update behavior.

## Local demo email and recording

For a fresh setup, run `npm run setup:local`, `npm run infra:up`, migrations, synthetic seed and interactive Admin bootstrap as README describes. The generated configuration uses Mailpit on 127.0.0.1:11025. Open 127.0.0.1:18025 to inspect local email. No real email is sent through this fake sink. Existing .env files are not rewritten; inspect existing SMTP settings before starting. The compose file is syntax-checked but has not been boot-tested in the delivery environment because Docker is unavailable there. Runtime DB/API/browser tests use local PostgreSQL 14 and a standalone Mailpit process; compose specifies PostgreSQL 17 and requires separate boot verification.

For a synthetic real-API recorded walkthrough, set `IAC_RECORD_DEMO=1` when running the Finance and equipment browser tests. Playwright saves one video per test in test-results. These test-only accounts bypass interactive sign-in setup to exercise business workflows; the recordings are not proof of real user onboarding or a hosted deployment. Do not expose test session tokens or .env in a recording or archive.

## Verification evidence

At the 22:26 checkpoint: 102 database/API integration tests, 27 API unit tests, 62 web unit tests and all 33 Chrome browser tests passed. Lint, TypeScript and production build passed. No production system, real company records or real email recipients were used.

Production dependency audit: zero reported vulnerabilities at the checkpoint after Nodemailer update and compatible body-parser/multer overrides. Full audit retains four low-severity development dependency findings. Audit output is a point-in-time advisory check, not a security guarantee.

## 50,000-asset query probe

Run from apps/api with an isolated `_test` database:

```sh
../../node_modules/.bin/tsx --env-file=../../.env src/scale-probe.ts
```

The script opens one transaction, inserts 50,000 synthetic assets in the reserved probe code range, analyzes queries, records 20 warm samples per query and EXPLAIN ANALYZE/BUFFERS evidence, then rolls back. Existing records using probe codes cause a safe conflict; do not run against production. This avoids changing the asset sequence. The probe is intentionally one local DB connection, not an HTTP load test.

Observed p95 milliseconds: catalog first page 1.97; exact asset lookup 0.18; contains search 16.99; asset status counts 6.42. Raw plans are in evidence/scale-probe-2026-10-28.json. A separate 40-request concurrent HTTP role-isolation regression passes, plus simultaneous Finance approval and concurrent worker claim tests. These bounded correctness checks are not sustained load/capacity certification. These numbers do not establish concurrent-user, attachment/history/import, storage, backup/restore or production availability capacity. Contains search still scans rows. A realistic mixed workload and recovery test remain release gates.

## Remaining product gates

Tenant isolation and tenant-aware authorization, provisioning/subscriptions/billing, SSO/SCIM, configurable approval routing, policy-approved finance/depreciation, procurement, budgets, stock/reorder rules, HR/offboarding, integrations/discovery, delivery bounces/alerts, restore drills and realistic concurrent load remain later releases. A grouped equipment view does not merge items or create a bulk atomic handover. Assignments remain explicit one-item actions with version checks.

The review workflow is fork -> feature branch -> pull request -> owner review. Do not merge upstream automatically.

## Finance history and runtime permissions

Finance history now has an asset-scoped cursor API and an earlier-events control. The integration regression walks 57 older tied-timestamp events without duplicates or omissions. The restricted iac_runtime test executes actual Finance submission/independent approval and verifies audit writes while denying evidence updates/deletes. This is not complete runtime-role coverage of every API.

Recovery/readiness checkpoint: disposable synthetic PostgreSQL14 logical restore passed complete-row digests for16coretables, custody/Finance integrity and immutable-evidence mutation rejection. New readiness endpoint checks required release schema and returns generic503 on failure. No production restore/PITR or PostgreSQL17 container verification is claimed.

Reproducibility checkpoint: actual tracked-source ZIP installed with `npm ci` into a clean directory, fresh setup generated private defaults, clean build/typecheck passed,18migrations applied to a fresh disposable database and the second migration run applied0. All current checks also pass under Node24.22.1. Executive summary queries now run in a read-only repeatable-read transaction, so totals/tickets/departments use the same snapshot during concurrent writes.

Setup regression: `npm run test:setup` checks private local file generation/preservation and production-helper validation/no-secret-output. The production helper is Unix/bash-based; Windows users need WSL or a separately approved setup route. No deployment has been executed.

SMTP test safety: required fake-mail dependency failures now fail acceptance/recovery tests rather than returning early as if they passed. A deliberate loopback-port1 run failed with the expected dependency error, then the complete101test suite passed with Mailpit available. Test SMTP settings override operational credentials.

Compiled-runtime smoke: in a separate clean directory, production-only `npm ci --omit=dev --ignore-scripts` completed and native Argon2 hash/verify plus Sharp image processing passed. Compiled API started against the synthetic database and `/api/v1/ready` returned200. This checks the installed production dependency surface on this Linux/Node24 environment, not the unboot-tested Docker image or real HTTPS login.

## Bounded mixed HTTP read probe

`npm run probe:load:test` creates a new loopback disposable `_test` database, applies migrations, generates50000synthetic assets/1000Finance submissions and runs20concurrent local HTTP readers for10seconds. It exercises catalog/search, Finance queue/history, Executive summary and forbidden Employee/IT calls. The28October checkpoint completed3004requests with0unexpected statuses/payloads/errors and unchanged Finance evidence. Raw aggregate latency is in docs/evidence/mixed-http-probe-2026-10-28.json.

This is a short correctness/latency probe, not sustained production capacity or an SLA. It excludes writes, files, imports, WAN latency, real users and SMTP. The script requires local test-owner CREATE DATABASE rights and deletes its disposable database. Do not run it against production or while sharing scarce resources with a live service.

Executive warranty due-window uses the organization date in Asia/Kolkata, matching existing Admin reports rather than the database server timezone. Regression compares the report to the explicit organization-date predicate.

Restricted HTTP checkpoint: `node scripts/load-probe.mjs --runtime-role` applies grants in its disposable database and forces each API connection into iac_runtime. It verifies `current_user`, completes one real HTTP Finance approval with audit/history, then runs the mixed-read probe. The observed2410requests had0unexpected payloads/status/errors. This uses the test owner connection with PostgreSQL role-switch options, not a separately provisioned production login/TLS route, and covers only exercised paths.

Finance queue flexibility: combine review state, free-text search, department and asset type. Filters reset their own server cursor; Load more preserves all filters. Options include inactive masters and legacy asset types actually present in inventory, so historical records remain reachable. Admin/Finance only; no approval policy or ownership permissions changed. API regression checks combined filters, page boundaries, validation/role denials and inactive department history; browser regression walks25to28records then changes type to2records on desktop/mobile.

Support triage flexibility: category and subject/ticket-number search combine with status/priority. Admin and IT can choose Any owner, Assigned to me or Unassigned. Cursor paging and CSV/Excel export use the same active filters. Employee scope stays reporter-only; direct team-ownership requests are rejected. No automatic routing, SLA timer or escalation policy has been invented.

22:52 delivery checkpoint:104/104integration and35/35browser tests passed;27APIunit/62webunit passed. An additional fresh-Admin browser test passes first password login, authenticator enrollment, recovery-code save gate, notice acceptance and second sign-in via recovery. Interactive bootstrap passed in a fresh disposable18migrationdatabase, credentials not logged. The delivery-health browser test now waits for its actual state-filter response before testing pagination after reload; no product behavior was relaxed.
