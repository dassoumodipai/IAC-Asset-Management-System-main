# IAC Asset Management Platform

System design and role-based user guide · 20 October 2026

This guide describes the implemented local MVP. Production hosting, branding approval, retention and Finance policy remain owner configuration. Diagrams show logical relationships rather than every database column. Screen sketches illustrate navigation; they are not live screenshots.

## 1. System architecture

```mermaid
flowchart LR
  A[Admin] --> UI[React + TypeScript portal]
  E[Employee] --> UI
  I[IT/Admin] --> UI
  UI -->|REST JSON + session cookie + CSRF| API[NestJS API / Node 24]
  API --> AUTH[Authentication and role / ownership guards]
  AUTH --> DOM[Assets · custody · tickets · masters · imports]
  DOM --> DB[(PostgreSQL)]
  DB --> AUD[Timestamped audit and retained history]
  DB --> OUT[Encrypted SMTP outbox]
  OUT --> W[Background notification worker]
  W --> SMTP[Configured SMTP provider]
  SMTP --> MAIL[Employee / staff email]
```

React renders role-specific navigation and uses cached queries with paginated lists. NestJS remains the authority for permissions, validation and record versions. PostgreSQL stores inventory, private photos, custody, ticket history and import provenance. Business writes, history and queued notifications commit together; the worker delivers asynchronously. A queued message is not proof of inbox delivery.

Local services: web `127.0.0.1:5173`, API `127.0.0.1:3000/api/v1`, and PostgreSQL on the private configured port. Configure an approved SMTP provider for local notifications. Automated tests use a separate database ending `_test` and isolated SMTP settings, never operational data or real SMTP credentials.

## 2. Logical data model

```mermaid
erDiagram
  USERS ||--o{ USER_ROLES : holds
  ROLES ||--o{ USER_ROLES : defines
  USERS ||--o{ SESSIONS : authenticates
  DEPARTMENTS o|--o{ ASSETS : classifies
  LOCATIONS o|--o{ ASSETS : locates
  ASSETS ||--o{ ASSIGNMENTS : custody_history
  USERS ||--o{ ASSIGNMENTS : receives
  ASSIGNMENTS ||--o{ ASSIGNMENT_EVENTS : records
  ASSETS ||--o| ASSET_PHOTOS : private_picture
  USERS ||--o{ TICKETS : reports
  ASSETS o|--o{ TICKETS : concerns
  TICKETS ||--o{ TICKET_UPDATES : retains
  IMPORT_BATCHES ||--o{ IMPORT_ROWS : preserves_source
  USERS ||--o{ DATA_TRANSFERS : previews
  NOTIFICATION_OUTBOX ||--o{ EMAIL_DELIVERIES : routes
  EMAIL_DELIVERIES ||--o{ EMAIL_ATTEMPTS : retries
```

Key rules: Asset IDs and master codes are permanent. Only one current custody may exist for an asset. Employee ID and names are reference data, not account identity; approved email identifies recipients. Portal acceptance and receipt acknowledgement are separate evidence. Raw import fields remain unchanged; corrections are stored separately. Audit events connect actions to actors, request IDs and timestamps. Reference values control categories, statuses and other options; fixed workflow codes permit label changes without changing behavior.

## 3. Roles and access

| Action | Admin | Employee | IT/Admin role alone |
|---|---|---|---|
| Create/edit assets, upload photos | Yes | No | No |
| Assign, transfer, return assets | Yes | No | No |
| Read asset information | Catalog | Own current custody | Related-ticket technical scope |
| Acknowledge assigned equipment | If acting as assigned Employee | Own custody | If separately an assigned Employee |
| Create support tickets | Own reporter | Own reporter | Own reporter |
| Respond/manage ticket queue and complete tickets | Yes | Own public discussion only | Yes |
| Read internal ticket notes | Yes | No | Yes |
| Manage people, masters, routing, imports, audit | Yes | No | No |

Roles can coexist on one account. Staff MFA is required. Employee responses exclude private financial/source fields and internal notes. UI visibility supports usability; server checks enforce access.

## 4. Sign in and first access

1. Obtain an approved invitation or ask Admin to approve your email before registration.
2. Use the invitation link to set up access, or complete approved registration and email verification.
3. Sign in with your own credentials. Staff complete authenticator enrollment/verification when prompted and keep recovery codes privately.
4. Read and accept the current portal notice. This authorizes portal access; it does not acknowledge any equipment.
5. Open your dashboard. Never share passwords, authenticator secrets or recovery codes in tickets or spreadsheets.

Expired invitation: ask Admin to use **People & access → Staff accounts → Resend invitation** on the invited account. A new invitation replaces earlier links. If an authenticator challenge expires, restart sign-in and enter a fresh current code; do not disable MFA to finish onboarding.

## 5. Admin daily workflow

### Set up departments and other masters

Open **Master Control**, select **Departments**, **Locations** or a reference group, then add an entry with a stable code, display name and reason. Save explicitly. Editing requires the current version and a change reason. Deactivate retired editable choices to preserve history. The default list shows active entries; choose inactive availability to find retired entries. Workflow groups allow display-label changes only.

### Onboard an employee

Open **People & access**, approve or invite the correct email, then wait for activation, email verification and portal acceptance. Assignment requires an active account with the Employee role. A staff account without that role is not an eligible custody recipient. Administrative role changes are privileged actions and may revoke existing sessions.

### Create an asset and add its photo

1. Open **Asset catalog → Create asset**.
2. Enter identity, category/type, ownership, condition, department and location. Use **In Store** for equipment ready for its first assignment.
3. Enter known financial metadata only; leave unknown values blank. Save to obtain the permanent generated Asset ID.
4. Open the saved asset's **Asset picture** panel. Choose JPEG/PNG up to 10 MiB, inspect the preview, enter a photo reason and choose **Save photo**.

Selecting a picture does not upload it. The server converts accepted photos, removes metadata and stores them privately. A labelled generic illustration appears until an actual laptop photo is saved.

### Assign, transfer and return

```mermaid
flowchart TD
  A[Create asset or promote reviewed register] --> B[In Store / no current custody]
  B --> C[Admin chooses eligible Employee]
  C --> D[Confirm assignment]
  D --> E[Current custody / pending acknowledgement]
  E --> F[Employee confirms receipt or disputes details]
  E --> G[Admin transfers with reason]
  G --> H[Previous custody closed / new custody created]
  H --> F
  E --> J[Admin records return condition and reason]
  J --> B
```

Open **Asset catalog → Assign asset**, choose equipment from the In Store chooser, select the employee, add an optional handover note and choose **Confirm assignment**. Catalog rows also offer the relevant action. If the recipient is not on the loaded page, load more employees. If none qualify, check account state, Employee role, email verification and portal acceptance in People & access.

Use **Transfer custody** for an already assigned asset. Choose a different recipient and enter the required reason. For return, use the asset's return controls and record condition, reason and any destination location. Custody changes queue normal notifications and retain history. A stale-version error means another change occurred: refresh, review the new state and deliberately retry. Do not repeatedly submit a stale handover.

## 6. Employee workflow

Open **Your assets**, select the equipment and review the permanent ID, description, serial number, condition and saved picture. Asset details and photos are read-only. Confirm receipt when accurate or report a discrepancy with a clear reason. Ask Admin to correct the inventory record; acknowledgement never edits the asset itself.

For support, open **Support desk → New ticket**, enter subject, category, priority and details, and optionally link your currently assigned asset. Include symptoms and troubleshooting already tried. Submit, then follow the ticket's public discussion. Previous ticket history remains available to its reporter after equipment is returned. Employees cannot see internal staff notes or complete tickets through staff controls.

## 7. IT/Admin ticket workflow

```mermaid
flowchart LR
  A[Reporter submits ticket] --> B[Open ticket + queued alerts]
  B --> C[Staff selects owner / works ticket]
  C --> D[Public reply or internal staff note]
  D --> C
  C --> E[Completed with resolution]
```

Open **Support desk**, filter the queue, inspect the request and related technical asset details, select an owner where appropriate and update progress. Choose visibility carefully: public replies are visible to the reporter; internal notes are staff-only. When resolved, record a meaningful resolution and mark **Completed**. Completing a ticket does not return or transfer equipment. Reopening completed tickets is outside the MVP.

## 8. Import, export and register review

| Task | Steps | Save boundary |
|---|---|---|
| Download a report | Apply filters → Export Excel/CSV | Read-only; all matching pages within scope |
| Load a form draft | Exact form template → one-row file → inspect → Load into form | Normal Save/Submit remains necessary |
| Bulk changes | Module template → file + reason → Validate import → inspect → confirm → Apply validated import | Entire valid batch applied atomically |
| Original register | Choose 42/44 layout → stage → review controls/corrections → reconcile → explicitly promote | Staging alone creates no inventory |

Excel/CSV files: one plain-value worksheet, up to 2 MiB, shared reader maximum 500 rows/100 columns. Bulk batches: maximum 50 rows and 60,000-byte JSON request. Exports: maximum 5,000 rows with an error instead of silent truncation. Bulk previews expire after 30 minutes until committed and belong to their creating user; Apply rechecks permissions and versions. Preview may reserve sequence numbers, so gaps in generated IDs are expected.

Use import templates rather than assuming report exports accept identical columns. Blank optional bulk cells generally omit changes; notification recipient lists explicitly allow blank to clear. Register correction rows replace the complete correction set for each supplied row; empty supplied fields reset prior overrides, while absent rows retain stored corrections. Typed correction cells use `json:<JSON value>`. Loading review files clears approvals and requires explicit review again.

Preserve original workbook/export fingerprints and raw source. Reconcile exact Asset IDs, known cost totals and missing-cost counts. Missing identity or ambiguous fields remain quarantined; names and Employee IDs do not authorize custody. Existing assets are not overwritten by promotion. Detailed fields and examples: [Transfer guide](DATA_TRANSFERS.md) and [REST API](API.md).

## 9. Screen design sketches

These sketches represent existing information hierarchy; they are not additional proposed features.

```text
ADMIN / ASSET CATALOG
┌──────────────────┬─────────────────────────────────────────────────┐
│ Overview         │ Asset catalog      [Assign asset] [Create asset]│
│ Asset catalog    │ Search [________________] Status [ ] Dept [ ]    │
│ Support desk     │ [Export Excel] [Export CSV] [Bulk import ▸]     │
│ Master Control   │ ID / Description  Status     Verification Action│
│ People & access  │ IAC-… / Laptop    In Store   No custody   Assign│
│ Import review    │ IAC-… / Laptop    Assigned   Pending      Transfer│
│ Audit / Routing  │                                      View →     │
└──────────────────┴─────────────────────────────────────────────────┘

ADMIN / ASSIGNMENT
┌────────────────────────────────────────────────────────────────────┐
│ ← Asset details                 Assign an asset                   │
│ Selected asset: IAC-… · Laptop         Status: In Store             │
│ Approved employee [Choose eligible employee                    ▾] │
│ Handover note     [____________________________________________]  │
│ New custody takes effect when confirmed; receipt is separate.     │
│ [Confirm assignment] [Cancel]                                    │
└────────────────────────────────────────────────────────────────────┘

EMPLOYEE / ASSET DETAIL
┌────────────────────────────────────────────────────────────────────┐
│ Your equipment · IAC-…                   Read-only details         │
│ [Private saved laptop picture]  Serial / model / condition        │
│ Receipt verification: [Confirm / report discrepancy workflow]     │
│ Need assistance? [Raise a ticket]                                │
└────────────────────────────────────────────────────────────────────┘

STAFF / TICKET DETAIL
┌────────────────────────────────────────────────────────────────────┐
│ Ticket #…  Subject               Status / priority / owner        │
│ Reporter description + related technical asset                   │
│ Timestamped conversation and permitted notes                     │
│ Reply [___________________] Visibility [Public / Internal]        │
│ Resolution [____________________________] [Mark Completed]       │
└────────────────────────────────────────────────────────────────────┘
```

Keep permanent IDs prominent, labels explicit and actions grouped by workflow. Use status text alongside colour. Tables scroll within their containers on small screens. Confirming custody, saving a photo, applying an import and promoting a register remain distinct deliberate actions.

## 10. Security and operational design

Opaque revocable HttpOnly cookie sessions, CSRF protection, exact-origin checks, staff MFA and server-side role/ownership guards protect writes and private records. Passwords are hashed; sensitive authentication/mail envelopes are encrypted. Version headers prevent lost updates, while idempotency keys protect supported replayable commands. SQL transactions coordinate custody, audit and outbox writes. History and permanent identifiers are protected by database constraints/triggers. Restricted production runtime grants must be applied after migrations.

Production needs an approved domain/TLS, reachable invitation origin, SMTP sender/groups, private secret management, backup/PITR and restore drills including photos, retention, monitoring and capacity validation. Do not publish private `.env` files or source employee workbooks. Local startup commands and checks are in [README](../README.md); production gates are in [PRODUCTION](PRODUCTION.md).

## 11. Troubleshooting and training checklist

| Symptom | Check / action |
|---|---|
| App cannot open | Start Docker, PostgreSQL and API/web; verify health; retain database volume |
| Empty assignment chooser | Create equipment or explicitly promote reviewed rows; asset must be In Store without custody |
| Recipient missing | Active + Employee role + verified email + accepted portal; load remaining pages |
| Saved option disappeared | Check inactive availability; retired choices remain in history |
| Invitation queued but absent | Admin checks routing/worker/provider; resend only invited accounts; inspect latest link |
| Version conflict | Refresh, inspect current state and retry deliberately |
| Import rejected | Use exact template, plain values, correct layout and size limits; correct preview errors |
| Employee needs an asset correction | Report discrepancy or ticket; Admin edits the catalog |

Training exercise with synthetic data: Admin creates a department and asset, adds a photo and assigns it to a verified Employee. Employee reviews details, acknowledges receipt and raises a ticket. IT staff responds and completes it with a resolution. Admin verifies audit history and exports a permitted report. Use isolated test data and an isolated SMTP test configuration for training; do not send test invitations to real people.

Documentation basis: implemented README, REST API, transfer contracts, review and verification records. No live employee records or credentials are included. This documentation task did not change application behavior or rerun application tests.
