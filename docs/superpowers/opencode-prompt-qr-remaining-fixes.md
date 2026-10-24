# Prompt for OpenCode — finish the QR asset feature

Copy everything below the line into OpenCode, run from the project root
(`E:\Projects\IAC-Asset-Management-System-main\IAC-Asset-Management-System-main`).

---

You are finishing a nearly complete feature in this repo: an IAC Asset Management portal (npm workspaces: `apps/api` NestJS 11 + PostgreSQL 17, `apps/web` React 19 + Vite 7 + react-router 7 + TanStack Query). The feature adds QR asset labels, a scan page (`/a/:assetCode`), tickets with up to 3 photos, an admin label-printing page (`/assets/labels`), and a PWA with an in-app QR scanner. All of it is built and its tests pass. A final code review found the issues below. Fix them all, then fix 8 older failing browser tests.

Read these first for intent and exact values:
- Spec: `docs/superpowers/specs/2026-10-23-qr-asset-tickets-design.md`
- Plan (see "Global Constraints"): `docs/superpowers/plans/2026-10-23-qr-asset-tickets.md`

## Ground rules
- Do not run `git commit`, `git add`, `git stash`, `git checkout`, `git reset` or create branches. The owner handles git.
- Never read or print `.env` (it holds secrets). Tests read it themselves.
- Node 24 is required (`engines >=24 <25`). Check `node -v` first. If it is not 24.x, stop and tell me.
- PostgreSQL runs in Docker (`npm run infra:up`, container `iac-asset-platform-db-1`, port 55432). Migrate the test DB with `npm run db:migrate -w @iac/api -- --test`.
- A dev server may already be running on ports 3000/5173. Playwright starts its own web server and refuses to reuse one, so stop the dev server (or ask me) before running e2e tests.
- Production nginx CSP is strict: `style-src 'self'`, no `'unsafe-inline'`. Never loosen it. React `style={{}}` props are fine; `<style>` elements and HTML `style="…"` strings are blocked in production.
- Match the surrounding code style. Run `npx prettier --write` only on files you change.

## Part A — review fixes

### Important (these break only in production, so dev tests won't catch them)
1. `apps/web/src/components/Labels.tsx` (~line 452) injects `<style>{'@page …'}</style>`, which CSP blocks.
   - Move the page sizes into `apps/web/src/labels/labels.css` as named pages, e.g. `@page a4 { size: 210mm 297mm; margin: 0 }` and `@page thermal { size: 50mm 25mm; margin: 0 }`.
   - Select them with `.label-sheet[data-layout="…"] { page: a4 | thermal }`.
   - Alternatively, use a constructed stylesheet via `document.adoptedStyleSheets`.
   - Remove every `<style>` element from the print path.
2. `apps/web/src/components/Scanner.tsx` (~line 46): set `highlightScanRegion: false` and `highlightCodeOutline: false` in the `qr-scanner` options. The library injects SVG with inline `style` attributes, which CSP blocks. Draw a simple scan frame with app CSS instead.
3. Offline cold start: `OfflineScreen` (in `apps/web/src/components/Pwa.tsx`) only mounts inside `Shell`. When the app starts with no network, `Guard` in `apps/web/src/App.tsx` shows a generic error. In Guard's error branch, when `!navigator.onLine`, show exactly: "You're offline. Connect to the internet to scan or raise a ticket." Reuse `OfflineScreen` if practical.

### Minor
4. `Pwa.tsx`: capture `beforeinstallprompt` with a module-level listener at import time, store the event, and have `InstallMenuItem` read it. Today the event is lost if it fires before `Shell` mounts.
5. `apps/web/src/components/Tickets.tsx` (~line 873): show "View linked asset →" only to ADMIN or IT_ADMIN, or to the asset's current holder. Other reporters get a 404 there.
6. `Tickets.tsx` (~lines 414-420): when the asset is locked from a scan (`scannedCode` set), the "Import / export form" loader must not change `assetId`.
7. `apps/web/src/components/Scan.tsx` (~line 46): treat an API 422 like a 404 and show "Asset not found. Check the sticker or contact IT." (A typed code over 40 characters returns 422.)
8. `Scan.tsx` (~line 118): users with role ADMIN or IT_ADMIN see "Open full record". Everyone else with `canViewFull` sees "View my asset".
9. `Labels.tsx` (~line 149): change the QR `margin: 0` to `margin: 1`, keeping the printed QR at ≥ 18 mm.
10. On mobile, the Scan button, the iOS install tip and the update prompt overlap at the bottom of the screen. Stack them so none overlap, using CSS only.
11. `infra/nginx.conf`: add `client_max_body_size 2m;` inside the `/api/` location.
12. `apps/api/src/domain-tickets.ts` (`createTicket`): sanitize photos one at a time with `for…of` instead of `Promise.all`. This caps peak memory at 3 large images.

### Spec gaps
13. Admin asset detail page (`AssetDetail` in `apps/web/src/components/Assets.tsx`): add a **Print label** button linking to `/assets/labels?ids=<asset id>`. Admins only.
14. Asset catalog (`AssetList` in `Assets.tsx`), admin only:
    - Add a "Last label printed" column from the item's `lastLabelPrintedAt`, showing "Not printed" when null.
    - Add a **Not printed yet** filter that sends `labelPrinted=no`.
    - The API already supports both.
15. `apps/web/src/labels/labels.css` (~line 31): print the asset ID in a large monospace font, `'IBM Plex Mono', ui-monospace, monospace` (the app already loads IBM Plex Mono).
16. `test/qr-scan.spec.ts`: add label-preview tests for layout `A4_14` (14 cells on a sheet) and `THERMAL_50x25` (1 cell per page), mirroring the existing `A4_24` test.

## Part B — 8 failing older browser tests
`npm run test:e2e` has 8 failures that come from an earlier UI restyle, not from the QR feature:
- `test/assignment-discovery.spec.ts` ×4
- `test/data-transfer.spec.ts` ×1
- `test/system.spec.ts` ×3

They fail on `getByLabel(...)` for fields rendered by the restyled custom Select in `apps/web/src/components/ui.tsx`.

1. Run those three specs and read the errors to confirm the cause.
2. Preferred fix: make the custom Select accessible, so its visible label is programmatically associated with it (`<label htmlFor>` + `id`, or `aria-labelledby`, with a correct role and accessible name). That fixes it for screen-reader users too, and the tests pass unchanged. Keep the visual design exactly as it is.
3. Update test code only where a test depends on DOM details that legitimately changed, for example `selectOption` on what is now a custom listbox. Drive the control as a user would (click the trigger, then the option). Never delete or skip tests, and never weaken assertions.

## Done when all of these pass (show me the output)
1. `npm run lint`
2. `npm run typecheck`
3. `npm test`, both workspaces
4. `npm run test:integration`
5. `npm audit --omit=dev --audit-level=high`
6. `npm run build`
7. `npm run test:e2e`: all specs, including `test/qr-scan.spec.ts`
8. Production checks after the build:
   - No `<style>` tag in `apps/web/dist/index.html`.
   - `grep -rl "__iacScanResult" apps/web/dist` finds nothing.
   - `apps/web/dist/sw.js` mentions `/api` only in the navigate-fallback denylist.

Finish with a short list: each item number, then what you changed (file:line).
