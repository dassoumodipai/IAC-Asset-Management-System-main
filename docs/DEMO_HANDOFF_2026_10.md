# IAC manager demo handoff

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

## Verification evidence

At the 21:31 checkpoint: 94 database/API integration tests, 27 API unit tests, 62 web unit tests and all 32 Chrome browser tests passed. Lint, TypeScript and production build passed. No production system, real company records or real email recipients were used.

Production dependency audit: zero reported vulnerabilities at the checkpoint after Nodemailer update and compatible body-parser/multer overrides. Full audit retains four low-severity development dependency findings. Audit output is a point-in-time advisory check, not a security guarantee.

## 50,000-asset query probe

Run from apps/api with an isolated `_test` database:

```sh
../../node_modules/.bin/tsx --env-file=../../.env src/scale-probe.ts
```

The script opens one transaction, inserts 50,000 synthetic assets in the reserved probe code range, analyzes queries, records 20 warm samples per query and EXPLAIN ANALYZE/BUFFERS evidence, then rolls back. Existing records using probe codes cause a safe conflict; do not run against production. This avoids changing the asset sequence. The probe is intentionally one local DB connection, not an HTTP load test.

Observed p95 milliseconds: catalog first page 1.97; exact asset lookup 0.18; contains search 16.99; asset status counts 6.42. Raw plans are in evidence/scale-probe-2026-10-28.json. These numbers do not establish concurrent-user, attachment/history/import, storage, backup/restore or production availability capacity. Contains search still scans rows. A realistic mixed workload and recovery test remain release gates.

## Remaining product gates

Tenant isolation and tenant-aware authorization, provisioning/subscriptions/billing, SSO/SCIM, configurable approval routing, policy-approved finance/depreciation, procurement, budgets, stock/reorder rules, HR/offboarding, integrations/discovery, delivery bounces/alerts, restore drills and realistic concurrent load remain later releases. A grouped equipment view does not merge items or create a bulk atomic handover. Assignments remain explicit one-item actions with version checks.

The review workflow is fork -> feature branch -> pull request -> owner review. Do not merge upstream automatically.
