# Feature: In-app announcement inbox

## Requirements

- While a signed-in user can access the portal, when IT publishes an announcement, the system shall make it available in an in-app inbox without requiring PWA installation or browser push permission.
- While a user views the inbox, the system shall show unread status and allow marking one or all announcements as read.
- While an authorized staff member publishes an announcement, the system shall save it to the inbox for eligible portal users and send Web Push as an optional extra when configured.

## Architecture

- Frontend: Responsive `/notifications` inbox route and workspace navigation badge; admin announcements publish to the inbox even when VAPID is unavailable.
- Backend: Persistent announcement and per-user read tables; authenticated inbox/read endpoints; publish stores a notice and optionally sends existing Web Push.
- Security: SessionGuard protects inbox and read endpoints; ADMIN/IT_ADMIN role protects publishing; Zod validates input; SQL is parameterized; destinations are restricted to internal pages; publishing is rate-limited per staff account and audited.

## Implementation plan

- [x] Add schema migration and runtime table grants.
- [x] Add authenticated inbox/read API and persistent publication.
- [x] Add user inbox route, navigation badge, and responsive states.
- [x] Update admin announcement form and optional push result messaging.
- [x] Run static type checks.
