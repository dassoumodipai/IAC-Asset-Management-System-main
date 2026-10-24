# Prompt for Codex / OpenCode — Admin dashboard UI

Copy everything below the line into the tool, run from the project root.

---

Build the admin dashboard screen for this IAC Asset Management portal (npm workspaces: `apps/api` NestJS + PostgreSQL, `apps/web` React 19 + Vite + react-router 7 + TanStack Query). **The API is already done and tested.** Your job is only the React UI, plus a few small API wiring checks.

## Rules
- Do not run `git commit`, `git add`, `git stash` or `git checkout`. Never read or print `.env`.
- Use Node 24 (`node -v` must be 24.x).
- Production CSP is `style-src 'self'`: never add `<style>` tags or HTML `style="…"` strings. React `style={{}}` props are fine.
- Add no chart library. Draw the charts with plain HTML/CSS, plus inline SVG for the line chart.
- Match the existing look: `apps/web/src/styles.css` tokens (`--navy`, `--ink`, `--muted`, `--border`, `--surface`) and the `Metric`, `Panel`, `PageTitle`, `Select`, `ErrorNotice` and `Loading` components in `apps/web/src/components/ui.tsx`.

## Already done (don't rebuild)
- `apps/api/src/admin-dashboard.ts`: `GET /api/v1/dashboard/admin` (ADMIN only, 403 otherwise), registered in `app.module.ts`.
- Tests: `apps/api/test/admin-dashboard.integration.test.ts`, 4/4 passing.
- Query params, all optional:
  - `fy`: start year of the financial year, Apr–Mar. `2024` means FY 2024-25. If omitted, the KPI uses the current FY.
  - `departmentId`: uuid.
  - `category`: reference code.
- Response shape. Amounts are INR, purchase cost only:
```ts
interface AdminDashboard {
  filters: { fy: number; fyLabel: string };            // e.g. 2026, "FY 2026-27"
  kpis: { totalAssets: number; totalSpend: number; fySpend: number; missingCost: number;
          assigned: number; assignedPct: number; openTickets: number; warrantyExpiring: number };
  spendByYear: { label: string; spend: number; count: number }[];        // last 6 FYs, oldest first, ignores fy filter
  spendByCategory: { label: string; spend: number; count: number }[];    // top 7 + "Other"; uses fy filter only if given
  spendByDepartment: { label: string; spend: number; count: number }[];  // same rules
  statusCounts: { label: string; count: number }[];                     // desc
  ticketWeeks: { weekStart: string; opened: number; completed: number }[]; // exactly 12, oldest first
  expiring: { assetId: string; assetCode: string; assetType: string; kind: 'Warranty' | 'AMC'; date: string }[]; // next 60 days, max 10
  topReported: { assetId: string; assetCode: string; assetType: string; tickets: number }[]; // max 5
  financeGaps: { assetId: string; assetCode: string; assetType: string; missingCost: boolean; missingDate: boolean }[]; // max 10
  recentActivity: { action: string; entityType: string; actor: string; occurredAt: string }[]; // last 10 audit events
}
```

## What to build

### 1. `apps/web/src/components/AdminInsights.tsx` (new), exporting `AdminInsights`
- **Filters row** across the top:
  - Financial year `Select`: "Current FY" (empty value) plus the last 6 FYs as `FY 2025-26`, etc. The value is the start year.
  - Department `Select`: "All departments" plus `useReferences().data.departments`, showing names; mark inactive ones "(inactive)".
  - Category `Select`: "All categories" plus the reference values of kind `category`. Check `References.tsx` for how category options are listed elsewhere.
- **Data:** `useQuery(['dashboard-admin', filters])` → `api<AdminDashboard>('/dashboard/admin' + queryString({...}))`, using `queryString` from `api.ts`. Show `Loading` on first load and `ErrorNotice` with retry on error.
- **6 KPI tiles** (`Metric`, inside `metric-grid`):
  - Total assets → `/assets`
  - Total spend
  - Spend in `filters.fyLabel`
  - Missing cost → `/assets`
  - Assigned (`assignedPct`%) → `/assets?status=Assigned`
  - Open tickets → `/tickets`
  - Format money with `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`, giving `₹1,00,000`.
- **5 charts**, each in a `Panel` with a title. All bar charts are single-series in `var(--navy)`, so they need no legend.
  1. Spend by financial year: vertical columns, with the value on each column cap and FY labels below.
  2. Spend by category: horizontal bars, with the label on the left and the ₹ value at the bar tip.
  3. Spend by department: horizontal bars, same style.
  4. Assets by status: horizontal bars showing counts.
  5. Tickets, last 12 weeks: line chart with 2 series, **opened `#2a78d6`** and **completed `#eb6834`**. This palette was checked for colour-blind safety; don't change it.
     - 2px lines and a recessive grid.
     - Legend with swatches above the chart, plus a direct label at each line's end.
     - Hover crosshair with a tooltip showing the week, opened and completed.
- **Chart mark rules:**
  - Bars ≤ 24px thick, with a 4px rounded data end and a square end at the baseline.
  - A 2px gap between adjacent bars.
  - Text uses ink tokens, never the series colour.
  - Every bar has a hover tooltip (a `title` is acceptable) and a hit area at least as big as the bar.
  - Empty data → a short "No priced assets yet" message instead of an empty chart.
  - Under each chart, add `<details><summary>View as table</summary>` with a `<table>` of the same data, for accessibility.
- **4 watch lists**, as compact tables in `Panel`s, with asset codes linking to `/assets/:assetId`:
  - Warranty & AMC expiring (60 days): code, type, kind, date.
  - Most-reported assets: code, type, ticket count.
  - Finance gaps: code, type, "Cost"/"Date" missing badges. Link "Fix in catalog" to `/assets`.
  - Recent activity: humanise the action (`TICKET_CREATED` → "Ticket created"), plus actor and relative or `displayDate` time from `ui.tsx`.
- **Layout:**
  - Desktop: KPI grid, then charts in a 2-column grid, then watch lists in 2 columns.
  - Mobile (< 768px): everything in 1 column, no horizontal scroll.
  - Put new CSS in `styles.css` with an `admin-insights` / `viz-*` prefix.

### 2. Wire it in
In `apps/web/src/components/Dashboards.tsx`, inside `AdminDashboard()`, replace the existing 4-tile `<div className="metric-grid four">…</div>` with `<AdminInsights />`. Keep the "What needs attention" and "Workspace actions" panels and `<StaffQueue />` below it.

### 3. Tests
- Vitest (`apps/web/src/*.test.ts`, node env): extract pure helpers into `apps/web/src/admin-insights.ts` (`formatInr`, `fyOptions(today)`, `humaniseAction`, `barPercent(value, max)`) and test them. For example:
  - `fyOptions(new Date('2026-10-23'))` starts with `{value:'2026',label:'FY 2026-27'}`
  - `humaniseAction('TICKET_CREATED') === 'Ticket created'`
  - `formatInr(100000) === '₹1,00,000'`
- Playwright: add one test to `test/qr-scan.spec.ts`, or a new spec using the same mocked-API pattern (`page.route('**/api/v1/**')`). Mock `/dashboard/admin` and assert that the KPI values, a chart bar, a watch-list link and the FY filter (which changes the request query) all render.

## Done when (show me the output)
1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run test:integration` (includes the dashboard API tests)
5. `npm run build`
6. The new Playwright test passes.

Finally, check the dashboard on the dev server at desktop width and at 375px width. Nothing may overflow or overlap.
