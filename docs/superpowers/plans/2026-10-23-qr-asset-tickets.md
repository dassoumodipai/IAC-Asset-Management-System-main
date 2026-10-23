# QR Asset Labels, Scan-to-Report Tickets and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Printable QR stickers per asset; signed-in staff scan one, see basic details and raise a ticket with up to 3 photos; the portal installs as a PWA with an in-app scanner.

**Architecture:** New NestJS `ScanController`/`LabelController` beside the existing domain controllers; ticket photos ride in the existing `POST /tickets` transaction and land in an insert-only `ticket_photos` table. The React app gains `/a/:assetCode`, a label print page, a scanner modal and `vite-plugin-pwa`. QR generation, label layout and scanning all run in the browser.

**Tech Stack:** NestJS 11, PostgreSQL 17, sharp, zod, React 19, react-router 7, TanStack Query 5, Vite 7, `qrcode` (generate), `qr-scanner` (decode), `vite-plugin-pwa`, node:test, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-qr-asset-tickets-design.md`

## Global Constraints

- **No git commits or branches.** The user manages version control; every task ends with "no commit".
- Node 24 (`engines >=24 <25`). Run all commands with Node 24.
- QR content: `${APP_ORIGIN}/a/<asset_code>`, error correction level M.
- Non-reportable statuses: `Retired`, `Disposed`, `Sold`, `Lost`, `Stolen`.
- Scan response must never include: serial number, barcode, cost/finance fields, holder identity, configuration, history, audit data.
- Ticket photos: max 3; client target ≤ 350 KB JPEG, max 1600 px longest side; server decoded input limit 400 KB per photo, output JPEG ≤ 400 KB, max 1600 px, all metadata stripped.
- `POST /api/v1/tickets` body limit 1.5 MB; every other route stays 64 KB.
- Label layouts: `A4_24` (3×8, 63.5×33.9 mm), `A4_14` (2×7, 99.1×38.1 mm), `THERMAL_50x25` (50×25 mm, one per page). QR ≥ 18 mm. Max 500 assets per print run.
- Label copy: asset ID, "IAC · Scan to report a problem", asset type.
- Page copy (exact): "This asset is no longer in service." · "This asset is marked lost or stolen. Please hand it to IT." · "Asset not found. Check the sticker or contact IT." · "This isn't an IAC asset label" · "New version available. Tap to reload." · "You're offline. Connect to the internet to scan or raise a ticket."
- New tables are insert-only for the runtime role (INSERT + SELECT, no UPDATE/DELETE).
- Service worker never caches `/api/*`.
- Pin exact versions of new npm dependencies when installing (`npm install -E`).

## Review Focus

1. **Huge or odd phone photos** (HEIC chosen from the gallery on iPhone, 48 MP images, portrait EXIF rotation): the user expects either a correctly rotated photo or a clear per-photo error, never a frozen form. Pinned by Task 7 vitest `preparePhoto rejects unsupported type with message` and Task 4 test `rotated JPEG is stored upright`.
2. **Return-to path abuse** (`?next=//evil.example`, `iac.returnTo` set to an absolute URL): login must land on `/dashboard`, never off-site. Pinned by Task 6 vitest `takeReturnTo ignores protocol-relative and absolute URLs`.
3. **Asset codes with odd characters/case in the URL** (`/a/iac-it-000123`, trailing spaces, URL-encoded): the scan should still find `IAC-IT-000123`. Pinned by Task 3 test `scan lookup is case-insensitive and trims`.
4. **Double-tapping Submit on a slow mobile connection with photos attached:** one ticket, not two. Pinned by Task 4 test `same idempotency key with photos returns the first ticket`.
5. **A4 sheet with start position past the last label (e.g. start 25 on 24-up):** the user expects the input clamped to 1–24, not a blank page. Pinned by Task 8 vitest `layoutPages clamps start position`.

---

### Task 1: Migration, runtime grants and privilege test

**Files:**
- Create: `apps/api/db/migrations/008_qr_tickets.sql`
- Modify: `infra/runtime-grants.sql`
- Test: `apps/api/test/privileges.integration.test.ts`

**Interfaces:**
- Produces: tables `ticket_photos(id uuid PK default gen_random_uuid(), ticket_id uuid NOT NULL FK tickets, position smallint NOT NULL CHECK 1–3, content bytea NOT NULL CHECK octet_length 1–409600, mime_type text NOT NULL DEFAULT 'image/jpeg' CHECK = 'image/jpeg', sha256 text NOT NULL CHECK '^[a-f0-9]{64}$', width int NOT NULL, height int NOT NULL, created_by uuid NOT NULL FK users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ticket_id, position))` and `asset_label_prints(id uuid PK, asset_id uuid NOT NULL FK assets, layout text NOT NULL CHECK IN ('A4_24','A4_14','THERMAL_50x25'), printed_by uuid NOT NULL FK users, printed_at timestamptz NOT NULL DEFAULT now())`, index `asset_label_prints_asset(asset_id, printed_at DESC)`, index `assets_code_lower(lower(asset_code))`.

- [ ] **Step 1: Extend the privilege test.** Inside the existing `SET LOCAL ROLE iac_runtime` block add assertions, using savepoints as the file already does for expected failures:
  - `INSERT INTO ticket_photos ...` and `INSERT INTO asset_label_prints ...` succeed (create a ticket/asset row first as the file does for other inserts).
  - `UPDATE ticket_photos SET position=1`, `DELETE FROM ticket_photos`, `UPDATE asset_label_prints SET layout='A4_14'`, `DELETE FROM asset_label_prints` each reject with SQLSTATE `42501`.
- [ ] **Step 2: Run and confirm failure.** `npm run test:integration` → privileges test fails (`relation "ticket_photos" does not exist`).
- [ ] **Step 3: Write `008_qr_tickets.sql`** (wrapped in `BEGIN;`/`COMMIT;` like 007) with the tables and indexes above. Append to `runtime-grants.sql`: `GRANT INSERT ON ticket_photos, asset_label_prints TO iac_runtime;` (SELECT is already granted on all tables).
- [ ] **Step 4: Migrate and pass.** `npm run db:migrate -w @iac/api -- --test`, then `npm run test:integration` → all pass.
- [ ] **Step 5: No commit** (user preference).

---

### Task 2: Shared image sanitizer

**Files:**
- Create: `apps/api/src/image-sanitize.ts`
- Modify: `apps/api/src/asset-photos.ts` (replace `sanitizePhoto`/`animatedPng`/`invalidPhoto` with the shared module)
- Test: `apps/api/test/image-sanitize.test.ts`; add to `apps/api/package.json` `test` script

**Interfaces:**
- Produces:
  ```ts
  export interface SanitizeOptions { inputLimit: number; outputLimit: number; maxWidth: number; maxHeight: number; quality: number; maxPixels: number; message: string }
  export interface SanitizedImage { content: Buffer; width: number; height: number; sha256: string }
  export async function sanitizeImage(dataUrl: string, options: SanitizeOptions): Promise<SanitizedImage> // throws UnprocessableEntityException(options.message)
  export const ASSET_PHOTO: SanitizeOptions  // 40*1024, 80*1024, 640, 480, 75, 4_000_000, existing asset message
  export const TICKET_PHOTO: SanitizeOptions // 400*1024, 400*1024, 1600, 1600, 80, 24_000_000, 'Each photo must be a JPEG or PNG picture up to 400 KB'
  ```

- [ ] **Step 1: Write unit tests** in `image-sanitize.test.ts` (node:test, generate inputs with `sharp`):
  - `strips EXIF and GPS`: JPEG created with `.withMetadata({ exif: { IFD0: { Copyright: 'x' }, GPS: {...} } })` → `(await sharp(out.content).metadata()).exif === undefined`.
  - `rotated JPEG is stored upright`: 200×100 JPEG with EXIF orientation 6 → output width 100, height 200.
  - `downscales to 1600 longest side`: 3200×1200 PNG with `TICKET_PHOTO` → width 1600, height 600.
  - `rejects fake image`: `data:image/jpeg;base64,` + base64 of `'hello'` → throws, message equals `TICKET_PHOTO.message`.
  - `rejects animated PNG` (reuse the asset test's fixture approach) and `rejects over inputLimit`.
  - `sha256 matches content`.
- [ ] **Step 2: Run** `npm test -w @iac/api` → new tests fail (module missing).
- [ ] **Step 3: Implement `sanitizeImage`** by moving the existing logic from `asset-photos.ts` and parameterising limits; compute width/height from the output metadata and the sha256 of the output. Update `AssetPhotoService.put` to `sanitizeImage(dataUrl, ASSET_PHOTO)`; keep its zod `dataUrl` max length derived from `ASSET_PHOTO.inputLimit`.
- [ ] **Step 4: Run** `npm test -w @iac/api` and `npm run test:integration` → all pass (asset photo integration tests unchanged and green).
- [ ] **Step 5: No commit.**

---

### Task 3: Scan API

**Files:**
- Create: `apps/api/src/scan.ts` (`ScanService`, `ScanController`)
- Modify: `apps/api/src/app.module.ts` (register both), `apps/api/src/domain-helpers.ts` (export `NON_REPORTABLE_STATUSES`)
- Test: `apps/api/test/scan.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const NON_REPORTABLE_STATUSES = ['Retired','Disposed','Sold','Lost','Stolen'] as const; // domain-helpers.ts
  // GET /api/v1/scan/:assetCode  (SessionGuard; any active portal user)
  interface ScanView { id: string; assetCode: string; category: string; assetType: string; manufacturer: string|null; model: string|null;
    department: string|null; location: { site: string; floor: string|null; room: string|null } | null;
    status: string; hasPhoto: boolean; reportable: boolean; canViewFull: boolean }
  // GET /api/v1/scan/:assetCode/photo → { dataUrl: string|null } (same shape as GET /assets/:id/photo)
  ScanService.view(req: AuthRequest, assetCode: string): Promise<ScanView>
  ScanService.photo(req: AuthRequest, assetCode: string): Promise<{ dataUrl: string|null }>
  ```
  Lookup: `WHERE lower(a.asset_code)=lower(btrim($1))`; 404 via `found()` when missing. `canViewFull` = admin, or `assetScope` match for this asset.

- [ ] **Step 1: Write integration tests** (copy the `before`/user/session setup from `asset-photos.integration.test.ts`; users: admin, holder employee, other employee, IT admin; one assigned asset, one `Disposed`, one `Lost`):
  - `staff sees basic view`: other employee → 200; keys exactly the `ScanView` keys; `canViewFull=false`; `reportable=true`.
  - `scan never leaks restricted fields`: JSON string of every role's response contains neither the serial number, barcode, holder email nor holder display name used in setup.
  - `holder and admin canViewFull`: both true.
  - `non-reportable statuses`: Disposed and Lost → `reportable=false`.
  - `scan lookup is case-insensitive and trims`: `/scan/${encodeURIComponent(' ' + code.toLowerCase() + ' ')}` → 200, same `id`.
  - `unknown code 404`, `unauthenticated 401`.
  - `photo for non-holder`: after admin PUTs a photo, other employee gets non-null `dataUrl` from `/scan/:code/photo`, but still 404 on `/assets/:id/photo`.
- [ ] **Step 2: Run** `npm run test:integration` → scan tests fail (404 route).
- [ ] **Step 3: Implement `ScanService`/`ScanController`** (`@Controller('scan')`, `@UseGuards(SessionGuard)`) with an explicit column list joining `departments` and `locations`; never `SELECT *`. Reuse `found`, `assetScope`, `admin` from `domain-helpers.ts`.
- [ ] **Step 4: Run** `npm run test:integration` → pass.
- [ ] **Step 5: No commit.**

---

### Task 4: Ticket photos and the reporting rule change

**Files:**
- Modify: `apps/api/src/domain-helpers.ts` (`ticketInput` gains `photos`), `apps/api/src/domain-tickets.ts` (`createTicket`, new `ticketPhoto`, photo count on `ticket`), `apps/api/src/domain.ts` (route `GET tickets/:id/photos/:position`), `apps/api/src/main.ts` (route-specific parser)
- Test: `apps/api/test/ticket-photos.integration.test.ts`

**Interfaces:**
- Consumes: `sanitizeImage`, `TICKET_PHOTO` (Task 2); `NON_REPORTABLE_STATUSES` (Task 3); table `ticket_photos` (Task 1).
- Produces:
  - `ticketInput.photos: z.array(z.string().max(<base64 length of 400 KB + 23>)).max(3).optional()`
  - `GET /api/v1/tickets/:id` response gains `photoCount: number`
  - `GET /api/v1/tickets/:id/photos/:position` (position 1–3) → `{ dataUrl: string }`, gated by `ticketScope`, 404 otherwise
  - `TicketDomain.ticketPhoto(req, ticketId, position): Promise<{ dataUrl: string }>`

- [ ] **Step 1: Write integration tests:**
  - `non-holder can report on an active asset`: other employee POSTs `{assetId, subject, description, category:'HARDWARE', priority:'MEDIUM'}` → 201; DB row has `assignment_at_creation_id IS NULL`.
  - `holder report records assignment` (regression): holder → `assignment_at_creation_id` = current assignment id.
  - `non-reportable asset rejected`: Disposed asset → 422 with message containing `not in service`.
  - `ticket with 3 photos`: 3 × ~150 KB JPEG data URLs → 201; `photoCount=3`; each `/photos/n` returns JPEG with no EXIF.
  - `4 photos rejected`: 422; no ticket row created (count before = after).
  - `one bad photo rejects whole ticket`: 2 good + 1 fake → 422; no ticket and no photo rows.
  - `same idempotency key with photos returns the first ticket`: two POSTs, same `Idempotency-Key` → same `id`; one row.
  - `photo access follows ticketScope`: reporter 200, admin 200, IT admin 200, another employee 404.
  - `body limit`: 1.4 MB body to `POST /tickets` is accepted by the parser (fails validation only if photos invalid); 70 KB body to `PATCH /assets/:id` → 413 with `Request exceeds the 64 KB limit`.
- [ ] **Step 2: Run** `npm run test:integration` → new tests fail.
- [ ] **Step 3: Body parser.** In `createApp`, before `app.use(json({ limit: '64kb' }))`, add `app.use('/api/v1/tickets', (req, res, next) => req.method === 'POST' && req.path === '/' ? json({ limit: '1536kb' })(req, res, next) : next())`. Express `json` skips already-parsed bodies, so the global parser leaves it alone. Make the error filter's 413 message state the actual limit for this route (`Request exceeds the 1.5 MB limit`).
- [ ] **Step 4: `createTicket`.**
  - Destructure `photos` out of `data` before `insertObject` (the tickets table has no such column).
  - Sanitize all photos **before** opening the transaction (`Promise.all(photos.map(p => sanitizeImage(p, TICKET_PHOTO)))`) so invalid input never takes row locks.
  - Replace the holder-only `found(...)` with: lock the asset, load `status`, reject with `UnprocessableEntityException('This asset is not in service and cannot be reported')` when it is in `NON_REPORTABLE_STATUSES`, and set `assignment` to the holder's current assignment when it matches `req.user.id`, else null.
  - Insert photos with `position` 1..n inside the same transaction.
  - Add `photoCount` to the audit `changes`.
- [ ] **Step 5: Read route.** `ticketPhoto` re-uses `this.ticket(req, ticketId)` for scope, then selects `content` by `(ticket_id, position)`; `found()` for 404. `ticket()` adds `photoCount` via `(SELECT count(*)::int FROM ticket_photos p WHERE p.ticket_id=t.id)`.
- [ ] **Step 6: Run** `npm run test:integration` and `npm test -w @iac/api` → pass.
- [ ] **Step 7: No commit.**

---

### Task 5: Label print recording and catalog filter

**Files:**
- Create: `apps/api/src/labels.ts` (`LabelService`, `LabelController`)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/domain-assets.ts` (`assets()` list), `apps/api/src/domain-helpers.ts` (`requestPage` accepted keys, if it whitelists)
- Test: `apps/api/test/labels.integration.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/asset-labels/prints` (Admin only, idempotent like other POSTs) body `{ assetIds: uuid[] (1–500, unique), layout: 'A4_24'|'A4_14'|'THERMAL_50x25' }` → `{ recorded: number, printedAt: string }`; one `asset_label_prints` row per asset; one audit event `LABELS_PRINTED` with `{ layout, count, assetIds }` (entity type `asset_labels`, entity id null).
  - `GET /api/v1/assets` items gain `lastLabelPrintedAt: string|null` (admin only; absent for non-admins); query `labelPrinted=no` restricts to assets with no print row (admin only, ignored otherwise).

- [ ] **Step 1: Write integration tests:**
  - `admin records a print run`: 2 assets → `recorded=2`; both list items have non-null `lastLabelPrintedAt`; audit row exists with `count=2`.
  - `labelPrinted=no filter`: excludes those 2, includes an unprinted asset.
  - `employee forbidden`: 403.
  - `limits`: 501 ids → 422; duplicate ids → 422; unknown asset id → 404 and nothing recorded.
  - `employee list has no lastLabelPrintedAt key`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** the service (single transaction, `INSERT ... SELECT unnest($1::uuid[])`, verify the count of existing assets first) and the list changes (lateral `max(printed_at)` subquery added only when `admin(req.user)`; `NOT EXISTS` filter for `labelPrinted=no`).
- [ ] **Step 4: Run** `npm run test:integration` → pass.
- [ ] **Step 5: No commit.**

---

### Task 6: Return-to after login and the scan page

**Files:**
- Create: `apps/web/src/return-to.ts`, `apps/web/src/return-to.test.ts`, `apps/web/src/components/Scan.tsx` (`ScanPage`)
- Modify: `apps/web/src/App.tsx` (`Guard` remembers the path; route `/a/:assetCode` inside `<Guard><Shell>`), `apps/web/src/components/Auth.tsx` (lines 62 and 467: use `takeReturnTo()` instead of `'/dashboard'`), `apps/web/src/types.ts` (`ScanView`, mirroring Task 3)

**Interfaces:**
- Consumes: `GET /scan/:assetCode`, `GET /scan/:assetCode/photo` (Task 3).
- Produces:
  ```ts
  export function rememberReturnTo(path: string): void   // sessionStorage 'iac.returnTo'; ignores '/login' etc. auth routes
  export function takeReturnTo(fallback?: string): string // returns and clears; fallback '/dashboard'
  export function ScanPage(): JSX.Element                 // route /a/:assetCode
  ```
  Safe path = string starting with `/`, not `//`, no `\`, length ≤ 300. Wrap storage access in try/catch.

- [ ] **Step 1: Vitest** `return-to.test.ts`:
  - `round trip`: remember `/a/IAC-IT-000123` → take returns it; second take returns `/dashboard`.
  - `takeReturnTo ignores protocol-relative and absolute URLs`: `//evil.example`, `https://evil.example`, `/\\evil` → `/dashboard`.
  - `ignores auth routes`: `/login` → `/dashboard`.
  - `storage throwing` → `/dashboard`, no exception.
- [ ] **Step 2: Run** `npm test -w @iac/web` → fail.
- [ ] **Step 3: Implement `return-to.ts`**; in `Guard`, call `rememberReturnTo(location.pathname + location.search)` before each `<Navigate>` to `/login`, `/security` or `/access`. In `Auth.tsx`, every post-auth `navigate('/dashboard')` and the saved-codes link become `takeReturnTo()`.
- [ ] **Step 4: Implement `ScanPage`.**
  - Fetch with `useQuery(['scan', code])`.
  - States and copy exactly as in the spec table (Global Constraints copy). Show the photo from `/scan/:code/photo` with the existing generic laptop fallback from `AssetPhoto.tsx` (export `GenericLaptop`).
  - **Report a problem** → `/tickets/new?asset=<assetCode>&assetId=<id>`.
  - Holder sees **View my asset** → `/assets/:id`; admin sees **Open full record** → `/assets/:id`.
  - Mobile-first layout using existing `ui.tsx` primitives.
- [ ] **Step 5: Run** `npm test -w @iac/web` and `npm run typecheck` → pass.
- [ ] **Step 6: No commit.**

---

### Task 7: Ticket form photos and ticket detail thumbnails

**Files:**
- Create: `apps/web/src/photo-prepare.ts`, `apps/web/src/photo-prepare.test.ts`
- Modify: `apps/web/src/components/AssetPhoto.tsx` (use the shared preparer with asset limits), `apps/web/src/components/Tickets.tsx` (`TicketForm`, `TicketDetail`), `apps/web/src/types.ts` (`Ticket.photoCount`)

**Interfaces:**
- Consumes: `photos` field and photo route (Task 4).
- Produces:
  ```ts
  export interface PrepareLimits { maxBytes: number; maxEdge: number }
  export const ASSET_LIMITS: PrepareLimits   // existing asset values (keep current behaviour)
  export const TICKET_LIMITS: PrepareLimits  // { maxBytes: 350*1024, maxEdge: 1600 }
  export async function preparePhoto(file: File, limits: PrepareLimits): Promise<string> // JPEG data URL; throws Error(user message)
  ```

- [ ] **Step 1: Vitest** `photo-prepare.test.ts` (jsdom; stub `createImageBitmap`/canvas as `api.test.ts` stubs globals):
  - `preparePhoto rejects unsupported type with message`: `image/heic` file → throws `Choose a JPEG or PNG photo. On iPhone, set Camera > Formats to Most Compatible or take the photo here.`
  - `scales longest edge to maxEdge`: stubbed 4000×3000 bitmap → canvas sized 1600×1200.
  - `steps quality down until under maxBytes`: stubbed `toDataURL` sizes [500 KB, 300 KB] → second returned.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement `photo-prepare.ts`** by moving `preparePhoto` from `AssetPhoto.tsx` and parameterising limits; `AssetPhoto.tsx` uses `ASSET_LIMITS`.
- [ ] **Step 4: `TicketForm`.**
  - When `?asset=` is present: show the asset code read-only, send `assetId` from `?assetId=`, and hide the "my assets" picker.
  - Photos section: **Take photo** (`<input type="file" accept="image/jpeg,image/png" capture="environment">`), **Choose photo** (same without `capture`), up to 3 previews each with **Remove**, a per-photo error line, and the inputs disabled at 3.
  - Send `photos` only when non-empty. Keep typed fields on any error.
- [ ] **Step 5: `TicketDetail`.** When `photoCount > 0`, render that many thumbnails, lazily fetching `/tickets/:id/photos/:n`; a click opens a full-size dialog.
- [ ] **Step 6: Run** `npm test -w @iac/web`, `npm run typecheck`, `npm run lint` → pass.
- [ ] **Step 7: No commit.**

---

### Task 8: Label printing page

**Files:**
- Create: `apps/web/src/labels/layouts.ts`, `apps/web/src/labels/layouts.test.ts`, `apps/web/src/components/Labels.tsx` (`LabelPrintPage`), `apps/web/src/labels/labels.css` (print styles)
- Modify: `apps/web/src/App.tsx` (admin route `/assets/labels`; nav link under Asset catalog), `apps/web/src/components/Assets.tsx` (admin **Print label** button → `/assets/labels?ids=<id>`), `apps/web/package.json` (`qrcode` + `@types/qrcode`, exact versions)

**Interfaces:**
- Consumes: `GET /assets?labelPrinted=no` and `lastLabelPrintedAt`, `POST /asset-labels/prints` (Task 5).
- Produces:
  ```ts
  export type LayoutId = 'A4_24' | 'A4_14' | 'THERMAL_50x25';
  export interface Layout { id: LayoutId; pageWidthMm: number; pageHeightMm: number; cols: number; rows: number; labelWidthMm: number; labelHeightMm: number; marginTopMm: number; marginLeftMm: number; gapXMm: number; gapYMm: number; qrMm: number }
  export const LAYOUTS: Record<LayoutId, Layout>;
  export function layoutPages<T>(items: T[], layout: Layout, startAt: number): (T | null)[][] // pages of cells; null = skipped cell
  export function scanUrl(origin: string, assetCode: string): string // `${origin}/a/${encodeURIComponent(assetCode)}`
  ```
  A4_24 values: 210×297 page, 3×8, 63.5×33.9 label, top 12.9, left 7.2, gapX 2.5, gapY 0, qr 22. A4_14: 2×7, 99.1×38.1, top 15.1, left 4.7, gapX 2.5, gapY 0, qr 26. THERMAL: 50×25 page, 1×1, margins 0, qr 18.

- [ ] **Step 1: Vitest** `layouts.test.ts`:
  - `A4_24 fits the page`: `marginLeft + cols*w + (cols-1)*gapX ≤ 210` and the same check vertically ≤ 297; likewise A4_14.
  - `layoutPages clamps start position`: 2 items, A4_24, `startAt=25` → treated as 24 (23 nulls, then item 1; item 2 on page 2 cell 1); `startAt=0` → 1.
  - `thermal one per page`: 3 items → 3 pages of 1 cell.
  - `qr at least 18 mm` for all layouts.
  - `scanUrl encodes`: `scanUrl('https://x.org','IAC-IT 1')` → `https://x.org/a/IAC-IT%201`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement `layouts.ts`.**
- [ ] **Step 4: Implement `LabelPrintPage`.**
  - Asset selection: reuse the catalog filters, add a **Not printed yet** toggle (`labelPrinted=no`), row checkboxes, **Select all matching** (loads pages up to 500), and preselect from `?ids=`.
  - Controls: layout picker; **Start at label #** (A4 only, clamped 1–cols×rows); an on-screen preview using the same mm CSS; the reminder "Print at 100% scale (no fit-to-page)".
  - QR codes come from `QRCode.toString(scanUrl(window.location.origin, code), { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })` as inline SVG.
  - **Print** runs `window.print()` with an `@page { size: <w>mm <h>mm; margin: 0 }` style injected for the chosen layout, and the app shell hidden in `@media print`. After the print dialog closes, a **Did the labels print correctly?** confirm; on yes, POST the print run.
- [ ] **Step 5: Run** `npm test -w @iac/web`, `npm run typecheck`, `npm run lint` → pass.
- [ ] **Step 6: No commit.**

---

### Task 9: PWA shell

**Files:**
- Create: `apps/web/public/pwa-192.png`, `apps/web/public/pwa-512.png`, `apps/web/public/pwa-maskable-512.png` (generated once from `apps/web/public/logo.png` with sharp; the icons live in the repo, the one-off generator script does not), `apps/web/src/components/Pwa.tsx` (`UpdatePrompt`, `InstallMenuItem`, `IosInstallTip`, `OfflineScreen`)
- Modify: `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (mount prompt/tip; install item in the user menu), `apps/web/index.html` (`theme-color`), `infra/nginx.conf` (CSP adds `manifest-src 'self'; worker-src 'self' blob:`; `Cache-Control: no-cache` for `/sw.js` and `/manifest.webmanifest`), `apps/web/package.json` (`vite-plugin-pwa`, exact version)
- Test: `apps/web/src/pwa-config.test.ts`

**Interfaces:**
- Produces: `export const pwaOptions: Partial<VitePWAOptions>` exported from `apps/web/pwa.config.ts` (imported by `vite.config.ts` and the test).
  - manifest: `name` 'IAC Assets', `short_name` 'IAC Assets', `start_url` '/dashboard', `scope` '/', `display` 'standalone', `theme_color` and `background_color` from the current `index.html` theme colour, the three icons (maskable purpose on the third).
  - workbox: `navigateFallback` '/index.html', `navigateFallbackDenylist: [/^\/api\//]`, `runtimeCaching: []`, `globPatterns: ['**/*.{js,css,html,png,svg,woff2}']`.
  - `registerType: 'prompt'`.

- [ ] **Step 1: Vitest** `pwa-config.test.ts`:
  - `api is never cached`: `navigateFallbackDenylist` matches `/api/v1/tickets`; `runtimeCaching` is empty.
  - `manifest values`: name, start_url, display and 3 icons as above.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** `pwa.config.ts`, register `VitePWA(pwaOptions)` in `vite.config.ts`, and generate the icons.
- [ ] **Step 4: `Pwa.tsx`.**
  - `UpdatePrompt` uses `useRegisterSW` from `virtual:pwa-register/react`; shows "New version available. Tap to reload."
  - `InstallMenuItem` captures `beforeinstallprompt`.
  - `IosInstallTip` shows once (localStorage flag in try/catch) on iOS Safari when not standalone.
  - `OfflineScreen` uses `navigator.onLine` plus online/offline events and the exact offline copy.
- [ ] **Step 5: Verify build.** Run `npm run build`. Expected: `apps/web/dist/manifest.webmanifest` and `apps/web/dist/sw.js` exist, and `grep -c "/api" apps/web/dist/sw.js` shows `/api` only inside the denylist regex.
- [ ] **Step 6: Run** `npm test -w @iac/web`, `npm run typecheck`, `npm run lint` → pass.
- [ ] **Step 7: No commit.**

---

### Task 10: In-app scanner

**Files:**
- Create: `apps/web/src/scan-url.ts`, `apps/web/src/scan-url.test.ts`, `apps/web/src/components/Scanner.tsx` (`ScannerDialog`)
- Modify: `apps/web/src/App.tsx` (Scan button in `.topbar`, prominent below 768 px), `apps/web/package.json` (`qr-scanner`, exact version)

**Interfaces:**
- Consumes: `/a/:assetCode` route (Task 6).
- Produces:
  ```ts
  export function assetPathFromScan(scanned: string, origin: string): string | null // '/a/<code>' or null
  export function ScannerDialog(props: { open: boolean; onClose(): void }): JSX.Element
  ```
  Accept only when `new URL(scanned).origin === origin` and the pathname matches `^/a/[^/]+$`; return the pathname (decoded, then re-encoded once).

- [ ] **Step 1: Vitest** `scan-url.test.ts`:
  - `accepts own label`: (`https://a.org/a/IAC-IT-000123`, `https://a.org`) → `/a/IAC-IT-000123`.
  - `rejects foreign origin`: `https://evil.org/a/IAC-IT-000123` → null.
  - `rejects other paths`: `https://a.org/admin/users`, `https://a.org/a/x/y` → null.
  - `rejects non-URL text`: `IAC-IT-000123`, `javascript:alert(1)` → null.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement `assetPathFromScan`.**
- [ ] **Step 4: Implement `ScannerDialog`.**
  - Full-screen `<video>` driven by `new QrScanner(video, onResult, { returnDetailedScanResult: true, preferredCamera: 'environment' })`.
  - On result: map it with `assetPathFromScan`; navigate and close on success, otherwise show "This isn't an IAC asset label" and keep scanning.
  - Stop the camera on close or unmount.
  - Camera error or denied permission: show a **Type the asset ID** input that navigates to `/a/<trimmed code>`. The input is always visible under the video too.
- [ ] **Step 5: Run** `npm test -w @iac/web`, `npm run typecheck`, `npm run lint` → pass.
- [ ] **Step 6: No commit.**

---

### Task 11: Browser tests, docs and full check

**Files:**
- Create: `test/qr-scan.spec.ts`, `test/qr-scan.playwright.config.ts` (mocked API, modelled on `test/asset-photo.playwright.config.ts` and the `page.route('**/api/v1/**')` pattern in `test/asset-photo.spec.ts`)
- Modify: `README.md` (new "QR labels and scan-to-report" section: printing, scanning, installing the app, migration 008 + reapply grants), `docs/API.md` (new routes)

- [ ] **Step 1: Write Playwright tests** (API mocked):
  - `scan link while logged out returns to the asset after login`: visit `/a/IAC-IT-000123` → login page → submit mocked login → URL is `/a/IAC-IT-000123`, heading shows the asset code.
  - `staff raises a ticket with two photos`: from the scan page click **Report a problem** → asset shown read-only → attach two fixture JPEGs via `setInputFiles` → submit → the captured request body has `photos.length === 2` and `assetId` → lands on the ticket page with 2 thumbnails.
  - `retired asset shows no report button` (exact copy).
  - `label preview renders 24 cells on A4_24 and posts a print run after confirm` (stub `window.print`).
  - `scanner rejects a foreign label`: expose a test hook (`window.__iacScanResult`, defined only when `import.meta.env.DEV`, so production builds strip it; Playwright runs against the Vite dev server) to inject `https://evil.org/a/X` → shows "This isn't an IAC asset label"; inject the own-origin URL → navigates.
  - Mobile viewport (375×812) screenshot of the scan page saved to `test-results/qr-scan/`.
- [ ] **Step 2: Run** `npx playwright test -c test/qr-scan.playwright.config.ts` → pass.
- [ ] **Step 3: Update docs** as listed.
- [ ] **Step 4: Full check.** Run in order and expect all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm audit --omit=dev --audit-level=high`, `npm run build`, `npm run test:e2e`, `npm run format:check`.
- [ ] **Step 5: Manual phone check (document results, don't automate):** on the dev server reached over HTTPS or localhost forwarding, install the PWA on one Android and one iPhone; print one A4_24 sheet and one thermal label; scan with the in-app scanner and the phone camera app; raise a ticket with a camera photo.
- [ ] **Step 6: No commit.**
