---
phase: mvp-implementation
reviewed: 2026-10-17T20:19:11.288Z
depth: deep
review_stage: final_static_review
files_reviewed: 56
files_reviewed_list:
  - .dockerignore
  - .github/workflows/ci.yml
  - .gitignore
  - README.md
  - apps/api/db/migrations/001_initial.sql
  - apps/api/db/migrations/002_security.sql
  - apps/api/db/migrations/003_source_vocabulary.sql
  - apps/api/package.json
  - apps/api/src/app.module.ts
  - apps/api/src/auth.ts
  - apps/api/src/cli.ts
  - apps/api/src/config.ts
  - apps/api/src/db.ts
  - apps/api/src/domain-assets.ts
  - apps/api/src/domain-helpers.ts
  - apps/api/src/domain-import.ts
  - apps/api/src/domain-tickets.ts
  - apps/api/src/domain.ts
  - apps/api/src/main.ts
  - apps/api/src/security.ts
  - apps/api/src/worker.ts
  - apps/api/test/auth.integration.test.ts
  - apps/api/test/auth.test.ts
  - apps/api/test/domain.integration.test.ts
  - apps/api/test/privileges.integration.test.ts
  - apps/api/test/worker.integration.test.ts
  - apps/api/tsconfig.json
  - apps/web/index.html
  - apps/web/package.json
  - apps/web/src/App.tsx
  - apps/web/src/api.test.ts
  - apps/web/src/api.ts
  - apps/web/src/components/Admin.tsx
  - apps/web/src/components/Assets.tsx
  - apps/web/src/components/Auth.tsx
  - apps/web/src/components/Dashboards.tsx
  - apps/web/src/components/Tickets.tsx
  - apps/web/src/components/ui.tsx
  - apps/web/src/hooks.ts
  - apps/web/src/main.tsx
  - apps/web/src/session.tsx
  - apps/web/src/types.ts
  - apps/web/tsconfig.json
  - apps/web/vite.config.ts
  - docs/API.md
  - docs/PRODUCTION.md
  - eslint.config.mjs
  - infra/Dockerfile
  - infra/compose.local.yml
  - infra/nginx.conf
  - infra/runtime-grants.sql
  - package.json
  - playwright.config.ts
  - scripts/dev-test.mjs
  - scripts/setup-local.mjs
  - test/system.spec.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
priority_counts:
  P0: 0
  P1: 0
  P2: 0
  P3: 0
status: clean
---

# IAC MVP code review

**Reviewed:** 18 October 2026 (Asia/Kolkata). The frontmatter timestamp is UTC.

**Scope:** 56 explicitly listed application, migration, test, package, infrastructure, CI, and run/API documentation files. Deep cross-file static review.
**Status:** Final source re-review completed; no unresolved confirmed P0-P3 finding in the reviewed scope. This supports local MVP evaluation, not production release approval. Runtime results below are explicitly attributed to the implementation agent.
**Reviewer:** Codex independent code-review agent.

## Review method

Read the workspace instructions and approved MVP_PLAN.md/source-map.json before source analysis. No CLAUDE.md or project-local .claude/skills or .agents/skills directories were present. Excluded ignored .env files, live workbook data, node_modules, generated dist/build outputs, lockfile contents, and generated browser reports.

Traced React requests through controller guards and DTOs to service transactions and SQL constraints. Reviewed authorization predicates before pagination, employee/private asset projections, current-custody checks, assignment locking/versioning, ticket visibility/terminal transitions, authentication token exchange/MFA/reset/session behavior, and domain/audit/outbox atomicity. Reviewed stable asset IDs, source-row preservation, manual email priority, exact ID and paisa reconciliation, sequence advancement, email leases/retries/expiry, and build/runtime configuration.

The reviewer did not run tests, build images, contact SMTP providers, deploy services, or modify application source. The implementation agent runs verification and records actual execution separately. This report distinguishes static confirmation of fixes from runtime evidence.

## Findings corrected during implementation

Counts in the frontmatter refer to currently open findings only. Sixteen defects, including one test-reliability defect, were corrected during this implementation/review cycle. The following source defects were reported to the implementation agent and the described fixes were read back in the shared workspace.

| ID | Priority | File and current line | Reproducible trigger and original issue | Concrete fix observed |
|---|---|---|---|---|
| RV-01 | P1 | [apps/api/src/auth.ts:322](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/auth.ts#L322) | A login reads the old password hash before a concurrent password reset, then obtains the user lock after reset revokes sessions. The original code issued a fresh session from its stale snapshot. | Reload the locked user, reject changed password hash/version or inactive state, and reload roles before issuing session/challenge. Locked-snapshot fix and mocked changed-hash regression reviewed; a real concurrent PostgreSQL interleaving was not separately exercised. |
| RV-02 | P1 | [apps/web/src/components/Auth.tsx:91](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Auth.tsx#L91); [apps/api/src/auth.ts:470](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/auth.ts#L470) | Choosing recovery-code login sent recoveryCode to a strict API accepting only code, producing 422 and preventing account recovery. | UI sends code consistently; API accepts exactly one of code/recoveryCode and consumes recovery codes transactionally. |
| RV-03 | P1 | [apps/web/src/components/Assets.tsx:30](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Assets.tsx#L30) | Creating any new asset left required ownership/risk dropdowns empty because UI kind names did not match OWNERSHIP/RISK. | Explicit kind aliases and reference code values replace label values. Asset type now uses the controlled selector. |
| RV-04 | P2 | [apps/api/src/db.ts:55](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/db.ts#L55); [apps/api/src/main.ts:104](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/main.ts#L104) | Audit events generated unrelated random request IDs, so a command could not be correlated with its response/log reference. | AsyncLocalStorage request context and actor requestId propagate the server-generated HTTP request ID; background jobs retain a generated fallback. |
| RV-05 | P2 | [apps/api/src/auth.ts:531](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/auth.ts#L531) | After 100 accounts, older employees were absent from user/assignment pickers with no cursor to retrieve them. | Bounded cursor pagination and user filters now return nextCursor; React assignment/account screens use paginated reads. |
| RV-06 | P2 | [apps/web/src/App.tsx:22](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/App.tsx#L22); [apps/web/src/components/Auth.tsx:328](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Auth.tsx#L328) | Setting PORTAL_NOTICE_VERSION beyond 1 caused perpetual client/server disagreement and failed acceptance. | API publishes currentNoticeVersion and UI compares, renders, and posts that server value. |
| RV-07 | P2 | [apps/web/src/components/Assets.tsx:963](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Assets.tsx#L963) | Submitting the optional assignment note blank sent an empty string rejected by the nonempty-if-present DTO. | Omit note when blank; preserve nonempty transfer reasons. Eligible picker also checks portal acceptance. |
| RV-08 | P2 | [apps/web/src/components/Admin.tsx:445](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Admin.tsx#L445) | Import review omitted required reconciliation fields and used the wrong correction shape; all review commands failed validation. A subsequent escaped newline regex also failed advertised multi-line Asset ID input. | Explicit expected IDs/cost/unknown count/Finance acceptance, fields corrections, and actual newline parsing now match the backend schema. |
| RV-09 | P2 | [apps/web/src/components/Admin.tsx:774](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Admin.tsx#L774) | Notification routing sent emails instead of enabled/recipients, making group setup fail. | PUT body now matches the strict group API and labels explain verified-role requirements. |
| RV-10 | P2 | [apps/web/src/components/Admin.tsx:336](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Admin.tsx#L336); [apps/web/src/components/Admin.tsx:589](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Admin.tsx#L589) | Audit UI read createdAt/summary instead of occurredAt/changes; user filtering used the wrong case. Import UI ignored per-row issues, hiding quarantine reasons. | Display current audit fields and USER filter; flatten rows[].issues for exception display. |
| RV-11 | P2 | [apps/web/src/components/Assets.tsx:681](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/web/src/components/Assets.tsx#L681) | Clearing an existing optional field omitted it from PATCH, leaving stale server data despite successful Save. | Emit null for previously populated nullable fields deliberately cleared; required catalog fields remain validated. |
| RV-12 | P2 | [apps/api/src/domain-assets.ts:132](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/domain-assets.ts#L132) | Asset history always appeared empty because the API supplied no timeline after movements. | Add Admin movement history and sanitized current-assignment-only employee events; IT-only users receive no custody history. |
| RV-13 | P2 | [apps/api/src/worker.ts:54](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/worker.ts#L54); [apps/api/src/worker.ts:90](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/worker.ts#L90) | Worker sent a sender-domain Message-ID but persisted an unrelated iac.portal ID, breaking message correlation. | Reuse sentMessageId for both send and accepted-delivery record. |
| RV-14 | P2 | [apps/api/src/domain-helpers.ts:186](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/src/domain-helpers.ts#L186) | IT-only asset queries bound an unused employee parameter, causing PostgreSQL parameter-count errors. Reported and reproduced by implementation integration checks. | Add the employee parameter only when the employee predicate is present. |
| RV-15 | P2 | [apps/api/test/auth.integration.test.ts:315](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/test/auth.integration.test.ts#L315) | The replay test recalculated the current TOTP after enrollment; crossing a 30-second boundary supplied a fresh valid code while expecting rejection. | Store acceptedEnrollmentCode and replay the exact accepted value, making the assertion independent of a time-step boundary. |
| RV-16 | P2 | [infra/runtime-grants.sql:8](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/infra/runtime-grants.sql#L8); [apps/api/test/privileges.integration.test.ts:22](https://github.com/RAY786/IAC-Asset-Management-System/blob/main/apps/api/test/privileges.integration.test.ts#L22) | Applying the restricted role made Admin reference upserts fail with SQL42501 because reference_values had SELECT permission only. | Grant INSERT/UPDATE without DELETE on reference_values and test a positive insert/update under SET LOCAL ROLE, alongside mutation/DDL denials. |

The initial category concern was superseded by reviewed migration 003_source_vocabulary.sql: IT Hardware is the approved canonical value, and the older generic IT Equipment value is inactive. It is not an outstanding finding.

## Reviewed invariants

- Registration/invitation grants Employee only. Privileged app access requires MFA and current portal acceptance; session reads resolve current roles and active state.
- Employee asset/detail/acknowledgement operations are scoped to current custody. IT ticket access does not expose financial/private inventory columns or other custodian history.
- Ticket updates apply visibility before pagination, and employee/internal-note commands and staff-only completion are guarded server-side.
- Asset IDs are unique and immutable. Custody commands use consistent asset-first locks and optimistic versions; a partial unique index prevents two open assignments.
- Ticket/assignment/import mutations, audit records, and encrypted per-recipient outbox writes share transactions.
- Import raw fields are retained for all 44 headers; manual override errors quarantine rows; Employee ID is not an account key. Reconciliation checks exact code sets, known cost amounts, and unknown cost counts.
- Worker uses expiring leases, SKIP LOCKED claiming, finite retries, token-mail expiry, payload purging, and per-recipient dispatch. SMTP duplicates after a crash remain possible and are acknowledged in the design.

These are source-level conclusions, not claims that every invariant has passed an executed test.

## Verification evidence and limits

**Reviewer actions:** Read-only source/call-chain analysis and static re-reading of all reported fixes. Rechecked final formatted lines, new HTTP/worker/privilege tests, deterministic TOTP replay, CI browser selection, runtime grants, local scripts, and API/run documentation. The reviewer did not execute tests, package-audit commands, container builds, or deployment actions.

**Implementation-agent results supplied to the reviewer on 18 October 2026:**

| Check | Reported result |
|---|---|
| Formatting, ESLint, TypeScript | format:check, lint, and typecheck passed |
| API and browser unit tests | 7 authentication/security unit tests plus 7 web API boundary tests passed |
| PostgreSQL/SMTP integration | 21 tests passed: 8 HTTP authentication, 9 custody/ticket/import domain, 1 runtime-grants case covering positive reference insert/update and 4 permission denials, and 3 SMTP acceptance/outage/lease-recovery tests |
| Browser workflows | 3 Microsoft Edge tests passed on final formatted source, including Employee and Admin UI workflows, access denials, and a loaded mobile dashboard without horizontal overflow |
| Dependency audit | Full npm audit, including development dependencies, reported zero vulnerabilities in every severity category |
| Images | Patched API and web images built successfully |
| Container smoke checks | API health and proxy health succeeded; web returned HTTP200 and a CSP header; API ran as uid1000 and native Linux Argon2 loaded |
| Cleanup | Implementation agent reported temporary smoke containers stopped |

These outcomes were supplied by the implementation agent, not independently executed by this reviewer. See VERIFICATION.md for its actual command/output record. The CI workflow was reviewed as source; a hosted GitHub Actions run was not observed. No production service or real employee dataset was deployed.

The stale-password login guard has a reviewed unit regression that simulates a changed locked user snapshot and asserts no new session; HTTP reset tests also cover single-use tokens and session revocation. This does not claim a separate real concurrent PostgreSQL login/reset interleaving test or exhaustive security coverage.

## Production and deployment limits

The following are operational release gates, separate from currently confirmed code defects:

- No approved production host/domain/region, employee identity mapping, notification recipients/sender, final branding, Finance policy, or retention policy has been supplied.
- Real external SMTP delivery and sender DNS policies, bounce handling, production role/login provisioning, backups/PITR/restore drills, load targets, and external signed immutable audit exports still need production evidence. Local SMTP, runtime-grant tests, image builds, and container smoke checks are reported above.
- Local Compose uses a development database owner and local mail sink. It is not the production deployment.
- The worker provides at-least-once SMTP submission with stable message IDs, not exactly-once inbox delivery.
- Current source import is restricted prepared JSON staging/reconciliation; original workbook export/archive approval remains an operator responsibility. No original source workbook was imported during this review.

---
_Review stage: final static review. Production readiness remains conditional on the stated deployment evidence and owner inputs._



## Master Control review supplement — 18 October 2026

An independent read-only review covered the new master domain and migration, controller and domain validation changes, runtime grants/tests, Admin route and Master Control editor, shared reference selectors/labels, asset/ticket forms, dashboards, types, styles, and the mutation refresh hook. No remaining confirmed actionable P0–P3 finding was reported in that scope. The reviewer did not run tests, read secrets or access operational data; runtime evidence is recorded by the implementation agent in VERIFICATION.md.

Reviewed properties: Admin-only setup writes and listing; strict kind/field allowlists; immutable master codes; required change reasons; versioned updates; case-insensitive duplicate protection; transactional before/after audit; fixed workflow codes; active-only new choices; retention of inactive or legacy values; appropriate runtime grants without master deletion; and shared display labels. Read-back corrections include legacy long metadata, duplicate-label retirement, unchanged nullable location sites, changed-only PATCH bodies, form limits and correct editor state after browser navigation.

The supplementary review also read back the awaited query invalidation that keeps ticket controls disabled until refreshed versions arrive, and the table-scroll positioning that contains absolute hidden header labels while preserving internal scrolling. These fix observed browser failures without weakening server-side version or authorization checks. Final local results: 47 tests pass; lint, types and production build pass. The browser test file has a separately reported pending formatting warning.


## Register compatibility focused review — 18 October 2026

Read-only focused review traced REGISTER_42 declared header enforcement, raw preservation, preferred manual email handling and the browser controls loader. One P2 stale file-read race was found and corrected with latest-read and committed batch/version guards, including stale-error suppression. No other confirmed actionable defect was found in this scope. The application retains explicit review and promotion, permanent source IDs, role/ownership checks and employee verification requirements. No real workbook, private directory or local secrets were accessed by the reviewer. Runtime evidence is recorded in VERIFICATION.md.


## Gmail SMTP setup review — 18 October 2026

An independent focused static review covered gmail-setup.ts, GMAIL_SMTP.md and the isolated integration/browser launchers. No confirmed actionable defect was found. The helper verifies Gmail TLS authentication without sending email or restarting processes, uses hidden input and sanitized errors, and preserves non-SMTP configuration during activation. The test launchers force local Mailpit and clear inherited SMTP credentials. Reviewers did not read private configuration, connect to live SMTP or send mail. Runtime evidence and pending owner credential steps are recorded in VERIFICATION.md.

## Resend invitation review — 18 October 2026

Independent read-only review traced the invited-row action through the existing invitation API and the expanded synthetic HTTP regression. No confirmed actionable defect was found. The UI offers resend only for invited accounts, uses a synchronous in-flight guard plus disabled controls to prevent duplicate clicks, submits the strict email/display-name payload, and clears pending state on success or failure. Feedback distinguishes queued requests from delivery. Server guards retain Admin-only access, existing-account state checks and replacement of old single-use tokens. The regression checks stable account identity, old-token rejection, new-token acceptance and replay rejection, Employee denial and active/disabled rejection. Reviewers did not access private configuration or send live invitations; executed checks are recorded in VERIFICATION.md.

## Asset photos and Employee read-only access — 18 October 2026

Independent focused review found no remaining confirmed actionable defect in the new photo service/controller, migration, runtime grants, React photo panel, read-only notice or synthetic tests. Existing asset edits and custody writes already require Admin server-side and use Admin route guards; Employees retain separate receipt/dispute and support workflows. A new regression asserts Employee and IT-only edit/assignment denial and an unchanged asset row.

Reviewed photo controls include current asset scope, lock-then-recheck behavior during custody changes, Admin/version/CSRF checks, canonical Base64 and matching JPEG/PNG signatures before decoding, bounded input/pixels/output, animation rejection, server re-encoding without metadata, transactional replacement/version/audit, private storage and no image bytes in audit. UI review covered accessible labels, explicit preview/save, stale selection/version guards, object URL cleanup, pending protection, retry, Employee-only viewing and clear illustration disclosure. The React review skill was applied to the changed components.

The six new HTTP tests use isolated synthetic accounts and pictures; mocked browser cases intercept every API call. Review caught a test fixture using an inactive legacy category; it now creates unique active synthetic reference values and all six HTTP cases pass. Runtime-grant coverage proves photo read/insert/update and delete denial. The reviewer performed static analysis and final read-back only; actual execution is recorded in VERIFICATION.md. No private records, live photos or secrets were read by the reviewer.

## Unknown option retirement — 18 October 2026

Independent read-only review found no actionable defect in migration006 or the three small frontend changes. Retirement affects only active condition/risk `Unknown` codes, advances versions and writes system audit in the same transaction. Master Control starts and resets to active entries; optional blank labels say Not set. Historical-value preservation, validation, requiredness, fixed data-wipe choices, missing-value displays and raw imports are unchanged. Existing integration coverage verifies inactive-choice rejection for new values and preservation on historical edits. Runtime evidence is recorded in VERIFICATION.md; the reviewer did not access private data or run tests.

## Excel and CSV transfers — 18 October 2026

Independent backend and frontend reviews covered the transfer service/controller, transaction context/savepoints, immutable staging migration, runtime grants, parser and exporters, shared transfer controls and business form integrations. Four confirmed P2 findings were corrected and read back: hidden asset/ticket reference enumeration through ticket preview; literal CSV apostrophe loss; missing current-correction draft exports; and a stale original-workbook hash after asynchronous CSV parsing. Final source read-back found no remaining confirmed actionable defect in the reviewed scope.

Reviewed controls include current actor/session/role/MFA/portal checks, ownership before lookup errors, strict module/header/field allowlists, rejecting credential columns before provenance storage, actor-bound expiring previews, atomic command/outbox/audit rollback, resource versions, immutable committed receipts and replay without duplicate actions. Case-insensitive duplicate invitation rows are rejected. Permanent register IDs remain in the existing reviewed import workflow. Runtime permissions allow required writes while preventing provenance deletion or rewrites.

Frontend review covered fresh filtered pagination and explicit export projections; Employee read-only assets and public ticket updates; single-form type/context binding and explicit load/save; renewed approvals after loading; preview invalidation on selection/reason/context changes; synchronous pending/generation guards; retry without silent application; CSV formula protection and reversible marked-form decoding; and bounded plain-value XLSX parsing including expanded ZIP validation. File imports never perform portal acceptance or custody acknowledgement. Existing audit and ticket history are export-only. React component review guidance was applied. Reviewers used source only and did not access private configuration, operational employee records or live SMTP. Executed verification and remaining limits are recorded in VERIFICATION.md.

## Assignment discovery and department setup — 19 October 2026

Independent read-only review found no remaining confirmed defect in the Admin assignment chooser, catalog actions, existing assignment form changes or the one-time owner-requested department maintenance operation. The new /assignments/new route is protected by the existing Admin guard. Chooser queries enforce In Store status; contextual actions follow current custody and terminal-state rules. Employee visibility and existing API checks remain authoritative. Recipient paging filters Employee roles and active accounts; local eligibility requires verified email and portal acceptance. Explicit confirmation binds the selected asset, operation and captured version; background refetch cannot silently advance the submitted version or retain an ineligible recipient.

Review found and resolved one P2 in the maintenance Apply step before execution: it now pins the exact reviewed workbook hash and add-only plan (13 creates, one unchanged IT identity/version, zero updates), with no UPDATE statement. Department IDs/codes stay permanent, source version cells are reference-only, the table is locked for atomic reconciliation, and each creation records system audit evidence including filename, hash, row and untouched raw fields. The source workbook, recovery data and one-time helper remain private workspace inputs, excluded from GitHub and the source archive. Reviewers did not read private configuration or execute maintenance, UI tests or email. Actual verification is recorded in VERIFICATION.md.
