# QR asset labels, scan-to-report tickets and PWA — design

Date: 2026-10-23 · Status: approved in conversation, pending written-spec review (not committed)

## Goal

Every asset carries a printed QR sticker. Any signed-in staff member scans it, sees basic details, and raises a support ticket with up to 3 photos. The portal installs as a PWA with an in-app scanner.

Success: a staff member with an installed app goes from scan to submitted ticket (with a photo) in under a minute, without knowing the asset ID; Admin/IT receive the ticket already linked to the right asset.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Who can scan and report | Any active, signed-in staff member (login + MFA as today). No public page. |
| What non-admins see | Basic details only. Admins see everything. |
| Label printing | Both A4 sticker sheets and single thermal labels |
| Ticket photos | Up to 3, attached when raising the ticket |
| App | PWA (installable, in-app scanner) |
| Build approach | Everything inside the existing app (browser QR generation, browser printing, client-side scanner). No new services. |

Out of scope (separate follow-up): Zoho People employee sync (joiners invited, leavers disabled, login unchanged). Also out: photos on ticket replies, offline ticket drafts, public/anonymous reporting.

## 1. QR link and scan page

- QR content: `${APP_ORIGIN}/a/<asset_code>` (e.g. `/a/IAC-IT-000123`). `asset_code` is immutable, so stickers never need reprinting after edits, moves or reassignment. QR error correction level M.
- New web route `/a/:assetCode` inside the existing `Guard` (login, MFA, verified email, accepted portal notice all still required).
- Return-to-scan: when `Guard` redirects an unauthenticated or incomplete session, it stores the requested path in `sessionStorage` (`iac.returnTo`). After login, `/security` and `/access` complete, the app navigates there once and clears it. Only same-origin paths starting with `/` (not `//`) are accepted.
- New API `GET /api/v1/scan/:assetCode` (SessionGuard, any active portal user). Returns:
  - basic fields: `asset_code`, `category`, `asset_type`, `manufacturer`, `model`, department name, location (site/floor/room), `status`, `hasPhoto`;
  - `reportable` (false for `Retired`, `Disposed`, `Sold`, `Lost`, `Stolen`);
  - the asset `id` (opaque UUID, needed to create the ticket; `/assets/:id` keeps enforcing its own access rules) and `canViewFull` (Admin, or the current holder via existing `assetScope`).
  - Never returns serial number, barcode, cost/finance fields, holder identity, configuration, history or audit data.
- New API `GET /api/v1/scan/:assetCode/photo` serves the existing asset picture to any active portal user (same headers and caching rules as the current photo route).
- Existing `/assets/:id` access rules are unchanged.

Page states:

| Case | Page |
|---|---|
| Active staff, reportable asset | Basic details + picture + **Report a problem** |
| Current holder | Same + link to their full asset view |
| Admin | Same + **Open full record** (existing admin asset page) |
| Retired / Disposed / Sold | "This asset is no longer in service." No report button |
| Lost / Stolen | "This asset is marked lost or stolen. Please hand it to IT." No report button |
| Unknown code | "Asset not found. Check the sticker or contact IT." |

## 2. Tickets with photos

- **Report a problem** opens the existing ticket form with the asset preselected and locked, via `/tickets/new?asset=<asset_code>`.
- Photos: up to 3, via `<input type="file" accept="image/jpeg,image/png" capture="environment">` (**Take photo**) and a gallery picker (**Choose photo**). Each has a preview and remove control.
- Client-side: decode, downscale to max 1600 px on the longest side, re-encode JPEG targeting ≤ 350 KB (stepping quality down), reusing the canvas approach in `AssetPhoto.tsx`.
- `POST /api/v1/tickets` accepts an optional `photos: string[]` (0–3 JPEG/PNG data URLs). The ticket, its photos, the `CREATED` update, audit and notification are written in the existing single transaction and idempotency wrapper: all or nothing.
- Body limit: a route-specific JSON parser of 1.5 MB is mounted for `POST /api/v1/tickets` only, before the global 64 KB parser. Every other route keeps 64 KB. Per-photo decoded limit 400 KB.
- Server-side: validate signature and type, reject animated images, re-encode with `sharp` to JPEG (max 1600 px, strips EXIF/GPS and all metadata), output cap 400 KB. Shared helpers are extracted from `asset-photos.ts` rather than duplicated.
- Storage: new table `ticket_photos(id uuid PK, ticket_id uuid FK, position smallint 1–3, content bytea ≤ 400 KB, mime_type 'image/jpeg', sha256, width, height, created_by, created_at, UNIQUE(ticket_id, position))`. Runtime role gets INSERT and SELECT only (no UPDATE/DELETE), added to `infra/runtime-grants.sql`.
- Read: `GET /api/v1/tickets/:id/photos/:position` behind the existing `ticketScope` (reporter, Admin, IT/Admin), `Cache-Control: private, no-store`. Ticket detail returns photo count; the page shows thumbnails that open full size.
- Rule change in `createTicket`: any active staff user may reference any **reportable** asset. `assignment_at_creation_id` is set only when the reporter is the current holder (unchanged behaviour); otherwise null. Non-reportable or missing assets are rejected with a clear message.
- The holder does not automatically gain access to tickets others raise on their asset.

## 3. Label printing (Admin only)

- New page **Asset catalog → Print QR labels**; a **Print label** button on each admin asset page.
- Selection: existing catalog filters plus **Not printed yet**; tick rows or **Select all matching** (max 500 per run).
- Layouts (CSS `@page` + mm grid, browser print dialog, user reminded to print at 100%):

| Layout | Grid / size | Option |
|---|---|---|
| A4 24-up | 3×8, 63.5×33.9 mm (Avery L7159-compatible) | Start at label # |
| A4 14-up | 2×7, 99.1×38.1 mm | Start at label # |
| Thermal | 50×25 mm, one label per page | — |

- Label content: QR (≥ 18 mm), asset ID in large monospace, "IAC · Scan to report a problem", asset type in small text.
- QR generated client-side by a small MIT-licensed library, rendered as SVG.
- Tracking: `POST /api/v1/asset-labels/prints` (Admin) records `{assetIds, layout}` into insert-only table `asset_label_prints(id, asset_id, layout, printed_by, printed_at)` plus an audit event `LABELS_PRINTED`. The catalog shows the last printed date and supports the **Not printed yet** filter. Recorded when the user confirms printing; not proof of physical printing.

## 4. PWA and scanner

- `vite-plugin-pwa`: manifest (`name` "IAC Assets", `start_url` `/dashboard`, `display` standalone, theme colour, 192/512 and maskable icons from the existing brand mark).
- Service worker precaches only the built app shell (HTML, JS, CSS, icons, fonts served from self). `/api/*` is never cached (network-only). Navigation fallback to an offline screen when there is no connection.
- Update prompt: "New version available. Tap to reload."
- Install: Android/Chrome shows an **Install app** menu item (from `beforeinstallprompt`); iOS shows a one-time Add to Home Screen tip.
- **Scan** button in the app header (prominent on mobile) opens a full-screen camera view using a small open-source client-side QR decoder (works on iOS Safari and Android). Frames never leave the device.
- Accepts only codes whose URL origin equals the app origin and path matches `/a/<asset_code>`; anything else shows "This isn't an IAC asset label". Fallback: type the asset ID manually (also used when camera permission is denied).
- CSP: nginx CSP stays `'self'`-based; add `worker-src 'self' blob:` only if the chosen decoder requires it, and `manifest-src 'self'`. Camera access needs HTTPS (production) or localhost (dev).

## 5. Errors and testing

Errors: unknown, retired, lost and offline states as above; per-photo validation messages without losing typed form data; duplicate submits handled by the existing idempotency key.

Tests:
- API integration (real database): scan basic view for staff; `canViewFull` for admin and holder; scan response contains no restricted fields; non-holder can create an asset ticket; non-reportable assets rejected; photo count/size/type limits, EXIF/GPS removed, fake images rejected; 64 KB limit still enforced on other routes; ticket photo access follows `ticketScope`; label print recording is Admin-only; runtime privilege test covers `ticket_photos` and `asset_label_prints` (no UPDATE/DELETE).
- Browser (Playwright): scan URL while logged out → login → returns to asset; raise ticket with photos and see thumbnails; label preview for each layout; scanner rejects a foreign QR URL (decoder result injected in test).
- Build check: manifest present; service worker excludes `/api`.

## Migration and deploy

- Migration `008_qr_tickets.sql`: `ticket_photos`, `asset_label_prints`, indexes. Reapply `infra/runtime-grants.sql` (done automatically by the `grants` service in `infra/docker-compose.prod.yml`).
- Caddy already allows 12 MB API bodies; no change. New npm dependencies: a QR generator, a QR decoder, `vite-plugin-pwa` (exact versions pinned at implementation).
