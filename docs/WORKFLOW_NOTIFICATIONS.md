# Workflow notifications

The Notifications page now has a persistent account-specific Workflow updates section alongside team announcements. Its unread state survives reloads and sessions. The navigation badge counts both kinds. Opening a workflow is separate from marking it read. Lists use keyset pagination and preserve database timestamp precision so several events in one transaction are not skipped.

New notifications are created in the same database transaction as their workflow. A rollback leaves neither workflow nor notification. Unique event key plus user ID prevents duplicate in-app notices on retry. The SMTP outbox remains the delivery path for email; a transport failure cannot remove a committed in-app notice. In-app read is not email delivery or proof the person took the requested action.

## Current event coverage

- Assignment, reassignment and return: affected employee, with equipment-list link. Imported custody creates a pending-verification notice for the user account; an invited user only sees it after activating, verifying and accepting the portal notice. Accepted/disputed acknowledgement notifies current Admin accounts with the asset link.
- Ticket creation: active verified Admin recipients, as the existing email triage policy specifies. Public replies: reporter when staff reply, or configured verified Admin/IT group recipients when reporter replies. Internal note bodies are never copied into notifications. Owner assignment notifies the new support owner. Status changes and completion notify the reporter.
- Finance submission: active verified independent Finance reviewers. Approved/returned decision: the submitting Admin when still eligible. No invoice content, cost, private reason or approval authority is copied into the notification.

Inbox visibility is bound to its original user ID and rechecks current active/verified/portal status plus current role/entity access on every read, count and mark-read. Revoked Admin/Finance/support privileges hide messages they no longer have permission to see. A former custodian's historical custody-closure notice links to their own current equipment page, not a now-inaccessible asset. Links still pass the target page's authorization checks. Restoring a role can make retained history visible again. The design is for this application's single database, not a claim of multi-tenant isolation.

## Limits and operations gates

No historical notifications are backfilled from old email. New workflow records are append-only; read receipts are personal state and not exposed to other users. The interface refreshes when focused and at a one-minute interval, not instant push. Broadcast/expiry policies, retention, digest preferences, notification volume and real provider setup need operational decisions. This does not configure Gmail, change SMTP transport, or guarantee real-world inbox delivery. Local Mailpit evidence must be labeled local test delivery.
