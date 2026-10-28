# What is connected now, and what remains

Checkpoint 29 October 2026, 00:43 IST. Local tested source is ahead of the partially published fork branch. No production deployment is implied.

| Capability | Current implementation | What can be configured now | Missing or later |
|---|---|---|---|
| Asset register | Existing API, PostgreSQL persistence, QR labels, photos, scoped detail/history | Reference categories/types/status labels, departments, locations and fixed asset fields | Arbitrary custom-field schemas, per-tenant metadata and field permissions |
| Person equipment | New Admin/Finance directory and employee-own view, current equipment grouped by person | Existing employee references, departments and item data | Atomic multi-item handover, configurable equipment bundles, HR sync |
| Custody | Existing assign/transfer/return, reasons, locks, versions, audit; incremental additions tested | Approved eligible recipients and fixed workflow inputs | Configurable approval routing and alternate custody policies; IT remains support-only |
| Finance | New submit/return/approve, independent reviewer, stale-version rejection and approved snapshot | Cost, invoice, supplier and dates within validated schema | User-configurable approval thresholds, depreciation/accounting policy, budget/procurement integration |
| Executive | Read-only approved acquisition cost/coverage/department and operational summary plus defined 12-week event counts | Existing source data; role assignments | Custom report builder, policy-approved valuation/depreciation, unrestricted department export |
| Tickets | Existing API/DB creation, item association, ownership/status/comments/photos and scoped access | Categories/priority reference data within existing rules | Configurable SLA calendars/escalation routes, external service desk sync |
| Imports | Existing typed templates, preview, explicit commit, fixed module rules and audit | Supported field values; valid rows imported while invalid rows skipped; emails opt-in | Arbitrary column/rule engine; large asynchronous import jobs; arbitrary source adapters |
| Notifications | Encrypted SMTP outbox/retry worker plus persistent scoped workflow inbox and announcements/push; read state and precise paging | SMTP environment settings, announcement audience/content/attachments and existing notification recipients | Editable/versioned operational email template designer, provider bounce/complaint events and alerts |
| Delivery health | New Admin-only real DB status/filter/attempt history | Filter/state/page presentation | Safe governed resend workflow, automated escalation, confirmed inbox delivery |
| Security/access | Existing sessions, portal acceptance and MFA, expanded to Finance/Executive; Finance evidence append-only | Existing roles/reference settings; role changes require reasons | Tenant isolation, SSO/SCIM, custom role/field permission builder, penetration testing |
| Scale | Repeatable rollback-only 50k-asset query probe plus short20concurrent-reader HTTP probe with payload/role checks | Local test dataset and query measurement | Sustained mixed read/write load, realistic history/photo/import volume, production capacity and production restore proof |
| SaaS operations | No multi-tenant SaaS claim | Local/single-organization deployment settings | Tenant onboarding/isolation, subscriptions/billing, custom domains, availability/recovery commitments |

## Real, simulated and unavailable connections

- Real in the test environment: React browser -> Nest API -> isolated PostgreSQL, including role/session checks, versioned mutations, audit evidence and cross-role reads. Chrome workflows check persisted state; separate API tests deny forbidden direct calls.
- Simulated delivery service: SMTP worker -> local Mailpit sink. It exercises acceptance/retry/lease recovery without emailing real people. Push/offline/update behavior is not certified by the browser suite, which blocks service workers for deterministic isolation.
- Not connected or invented: HRIS, ERP/accounting, asset-discovery, identity provider, payment/billing and production mail provider. No credentials, vendors or paid deployments have been chosen on the user's behalf.
- External product research informed the roadmap; it does not mean third-party product APIs are connected.

## Tested checkpoint

At the 22:26 checkpoint, 102 integration, 27 API unit, 62 web unit and 33 Chrome browser tests passed, plus lint/typecheck/production build. These counts certify only their exercised cases. They do not turn missing roadmap modules into working features or prove unlimited scale.

Latest flexibility addition: Finance queue department/asset-type filters are connected to server paging and historical master/inventory options. It does not add configurable approval routes or custom-field schemas. Finance API regression suite and5Financebrowser tests pass; decisive full regression will be repeated at the delivery checkpoint.

Support triage now exposes category/search and team ownership views (Any/Mine/Unassigned), with scoped exports and paging. This is queue flexibility, not automated assignment/escalation or configurable SLA policy.

## Overnight additions

- Private retained PDF/XLSX invoice evidence, hashes, bounded local extraction, explicit per-field review/apply and separate independent Finance approval. Source ID/hash and download remain in approval history. No OCR, universal layout handling or automatic per-asset allocation. See `INVOICE_EVIDENCE.md`.
- Transactional account-specific workflow notifications alongside queued email, separate persistent read state and current-role/entity access rechecks. No real Gmail transport configured. See `WORKFLOW_NOTIFICATIONS.md`.
- Full-viewport scanner dialog fix; browser test decodes actual generated QR pixels from a simulated video stream and opens the server-backed asset view. Physical camera/printer conditions still unverified.
- Executive weekly activity counts are source-recorded approval events (including amendments), ticket creation and completion in Kolkata Monday-start weeks. Current week is partial; zeros are recorded-event zeros, not proof no historical activity occurred. No spend, backlog, SLA or historical valuation trend is implied.

Latest source verification and measurements are recorded at each handoff. Earlier counts above are historical checkpoints, not the final test inventory. PR remains held until the user asks. No production deployment, external mail, private real inventory or upstream merge was performed.

Physical stocktake now supports Admin frozen expected snapshots, immutable per-item Seen/Not found/Mismatch observations, explicit unobserved/extra counts, correction history and close without mutating inventory or Finance. It is an evidence slice, not automatic reconciliation/dual-control signoff. See `STOCKTAKE.md`.

Admin lifecycle attention now shows recorded warranty/AMC due/expired/missing dates and outstanding custody for recovery planning, including disabled/role-changed accounts. This is read-only preparation, not automatic reminders or a full offboarding signoff workflow. See `LIFECYCLE_ATTENTION.md`.
