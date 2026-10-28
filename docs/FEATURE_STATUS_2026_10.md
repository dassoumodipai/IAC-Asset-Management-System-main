# What is connected now, and what remains

Checkpoint 28 October 2026, 21:40 IST. Local tested source is ahead of the partially published fork branch. No production deployment is implied.

| Capability | Current implementation | What can be configured now | Missing or later |
|---|---|---|---|
| Asset register | Existing API, PostgreSQL persistence, QR labels, photos, scoped detail/history | Reference categories/types/status labels, departments, locations and fixed asset fields | Arbitrary custom-field schemas, per-tenant metadata and field permissions |
| Person equipment | New Admin/Finance directory and employee-own view, current equipment grouped by person | Existing employee references, departments and item data | Atomic multi-item handover, configurable equipment bundles, HR sync |
| Custody | Existing assign/transfer/return, reasons, locks, versions, audit; incremental additions tested | Approved eligible recipients and fixed workflow inputs | Configurable approval routing and alternate custody policies; IT remains support-only |
| Finance | New submit/return/approve, independent reviewer, stale-version rejection and approved snapshot | Cost, invoice, supplier and dates within validated schema | User-configurable approval thresholds, depreciation/accounting policy, budget/procurement integration |
| Executive | New read-only approved acquisition cost/coverage/department and operational summary | Existing source data; role assignments | Custom report builder, policy-approved valuation/depreciation, unrestricted department export |
| Tickets | Existing API/DB creation, item association, ownership/status/comments/photos and scoped access | Categories/priority reference data within existing rules | Configurable SLA calendars/escalation routes, external service desk sync |
| Imports | Existing typed templates, preview, explicit commit, fixed module rules and audit | Supported field values; valid rows imported while invalid rows skipped; emails opt-in | Arbitrary column/rule engine; large asynchronous import jobs; arbitrary source adapters |
| Notifications | Existing encrypted SMTP outbox/retry worker plus in-app announcements/push; unread history now paged | SMTP environment settings, announcement audience/content/attachments and existing notification recipients | Editable/versioned operational email template designer, provider bounce/complaint events and alerts |
| Delivery health | New Admin-only real DB status/filter/attempt history | Filter/state/page presentation | Safe governed resend workflow, automated escalation, confirmed inbox delivery |
| Security/access | Existing sessions, portal acceptance and MFA, expanded to Finance/Executive; Finance evidence append-only | Existing roles/reference settings; role changes require reasons | Tenant isolation, SSO/SCIM, custom role/field permission builder, penetration testing |
| Scale | Repeatable rollback-only 50k-asset query probe with EXPLAIN evidence | Local test dataset and query measurement | Sustained mixed concurrent HTTP load, realistic history/photo/import volume, production capacity and restore proof |
| SaaS operations | No multi-tenant SaaS claim | Local/single-organization deployment settings | Tenant onboarding/isolation, subscriptions/billing, custom domains, availability/recovery commitments |

## Real, simulated and unavailable connections

- Real in the test environment: React browser -> Nest API -> isolated PostgreSQL, including role/session checks, versioned mutations, audit evidence and cross-role reads. Chrome workflows check persisted state; separate API tests deny forbidden direct calls.
- Simulated delivery service: SMTP worker -> local Mailpit sink. It exercises acceptance/retry/lease recovery without emailing real people. Push/offline/update behavior is not certified by the browser suite, which blocks service workers for deterministic isolation.
- Not connected or invented: HRIS, ERP/accounting, asset-discovery, identity provider, payment/billing and production mail provider. No credentials, vendors or paid deployments have been chosen on the user's behalf.
- External product research informed the roadmap; it does not mean third-party product APIs are connected.

## Tested checkpoint

At the 22:06 checkpoint, 98 integration, 27 API unit, 62 web unit and 33 Chrome browser tests passed, plus lint/typecheck/production build. These counts certify only their exercised cases. They do not turn missing roadmap modules into working features or prove unlimited scale.
