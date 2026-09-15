# Notifications support plan

## Summary

Relay should notify the owner when asynchronous work crosses back into their
hands. The first release should focus on two task-run outcomes—**result ready**
and **run failed**—plus time-based **owner-action reminders**. These events are
high-value because they happen while the owner may be away from the app and
usually require a decision.

Notifications should have two coordinated surfaces:

1. A durable in-app notification center, available to every signed-in user.
2. Optional web push for urgent, actionable events when Relay is not visible.

Do not notify for every task status transition. Queueing, worker claims,
editing, acceptance, linking, and completion initiated by the current user are
already visible and would create noise.

## Product goals

- Bring the owner back when a result is ready to review or a run needs help.
- Surface due work without requiring the owner to keep checking My Work.
- Preserve a trustworthy history if a push is missed or denied.
- Make every notification open directly to the item that needs attention.
- Default to a quiet experience with explicit control over push and reminders.

Non-goals for the first release:

- Chat-style notifications or progress updates from a running worker.
- Email, SMS, or third-party messaging channels.
- Collaborative notifications; Relay currently has one owner per record.
- User-authored recurring reminders or complex automation rules.

## Recommended notification moments

| Event | Priority | In-app | Web push | Default | Destination |
| --- | --- | --- | --- | --- | --- |
| Run completed with a result | High | Yes | Yes | On after push opt-in | Task result and review controls |
| Run failed | High | Yes | Yes | On after push opt-in | Failure details and Retry/Add to My Work controls |
| Owner action reaches its due time | High | Yes | Yes | On after push opt-in | Owner-action detail |
| Snoozed owner action returns to Active | Medium | Yes | Optional | Push off by default | Owner-action detail |
| Queued run has no worker after a threshold | Low | Later | Optional | Off | Task and Worker setup |

### Events that should not notify

- `run.queued` and `run.claimed`: these are expected progress, not owner
  handoffs. The existing status UI and four-second foreground polling cover
  them.
- Task created or edited, feedback submitted, result accepted, and owner action
  completed: these are direct consequences of the owner's current action.
- Worker heartbeat or online/offline transitions: too volatile for the initial
  experience. A future “queued too long” notification is more meaningful.
- Repeated overdue reminders: one notification at the due time is sufficient
  for v1. Re-notification should only be added with an explicit cadence setting.

## In-app experience

Add a bell to the top bar, before Worker setup. Its badge should show the number
of unread notifications, capped visually at `9+`. Selecting it opens a sheet on
mobile and a right-side popover/panel on larger screens.

The notification center should:

- Group notifications into Today, Earlier, and older dates.
- Show an icon, short title, one-line context, relative time, and unread state.
- Open the relevant task or owner action and mark that notification read.
- Offer “Mark all as read.” Individual deletion is unnecessary for v1; retain
  notifications for 30 days and expire them automatically.
- Show a useful empty state: “Nothing needs your attention.”
- Refresh while the app is visible, including after an active run finishes.

Suggested copy:

- Result: **Result ready to review** — “{task title} finished attempt {n}.”
- Failure: **Run needs attention** — “{task title} failed on attempt {n}.” Do
  not include the raw worker error in push content; show it after opening Relay.
- Due action: **Action due now** — “{action title}.”
- Unsnoozed: **Action is back in My Work** — “{action title} is active again.”

Opening a notification should use a durable deep link, for example
`/?task=<uuid>` or `/?action=<uuid>`. The dashboard should resolve that query,
switch to Tasks or My Work, select the correct status/filter, open the detail,
and gracefully fall back to the notification center if the record was deleted.
This also makes web-push clicks and future email links reliable.

When Relay is already visible and focused, update the in-app badge/list but do
not also display an operating-system notification. The changed task card or
detail can receive a brief, accessible highlight instead.

## Permission and settings experience

Never request browser notification permission on first load. Browsers are more
likely to deny an unexplained prompt, and iOS requires the PWA to be installed
before web push is available.

After the owner queues their first run, show a small, dismissible education card:
“Get notified when your laptop finishes.” Its Enable button first explains the
benefit and supported events, then invokes the browser permission prompt from
that user gesture. Also expose the same control in a new Notifications section
reachable from the bell panel.

Settings for v1:

- Web push master switch with states Enabled, Disabled, Unsupported, and
  Blocked in browser settings.
- Result ready (on by default once push is enabled).
- Run failed (on).
- Owner action due (on).
- Snoozed action returns (off).

In-app notifications remain on because they are the durable activity record;
the switches control push delivery only. Include concise instructions when the
browser has blocked permission. A device list can come later, but disabling push
on the current device must unsubscribe that endpoint immediately.

## Data and delivery design

Use a notification record as the source of truth and treat push as one delivery
attempt for that record. Do not send push directly from request handlers without
first persisting it; otherwise a transient failure loses the notification.

Suggested tables:

### `notifications`

- `id`, `user_id`
- `type` (`run_completed`, `run_failed`, `owner_action_due`,
  `owner_action_unsnoozed`)
- nullable `task_id`, `run_id`, and `owner_action_id` foreign keys
- `title`, `body`, and small JSON `data` payload for destination/attempt number
- `created_at`, `read_at`, `expires_at`
- `dedupe_key` unique per user, such as `run_completed:<run_id>` or
  `owner_action_due:<action_id>:<due_at>`

Index `(user_id, read_at, created_at desc)` and enforce owner-scoped row-level
security. Keep rendered copy with the record so the history remains coherent
if a task title later changes.

### `push_subscriptions`

- `id`, `user_id`, `endpoint`, encrypted `p256dh` and `auth` values
- `user_agent`, `created_at`, `last_success_at`, `disabled_at`
- unique endpoint and owner-scoped row-level security

Subscription secrets must never be returned in list APIs or logged. Send only
the notification ID, generic copy, and destination identifiers in a push. Never
include task instructions, result Markdown, artifacts, or worker error details
on a lock screen.

### `notification_preferences`

- `user_id` primary key
- booleans for each push category
- optional `timezone` for future local-time digests/quiet hours
- `updated_at`

Create notifications in the same database transaction as the state transition
where possible. The current completion/failure routes update a run, update a
task, and append an `events` row separately; moving each transition into a
transactional database function would prevent partial state and guarantee one
notification. Existing `events` remain the audit log; notifications are the
user-facing attention model.

A delivery worker should claim unsent deliveries, send Web Push using VAPID,
record success/failure, and retry temporary errors with bounded backoff. A
`404`/`410` response disables the subscription. Vercel Cron or a Supabase
scheduled function can run delivery; it should not depend on the owner's local
Relay worker being online.

For due and unsnoozed owner actions, a scheduled job should select eligible
records using server timestamps and insert deduplicated notifications. Run it
every minute or every five minutes depending on acceptable reminder precision.
Updating a due/snooze time naturally creates a new dedupe key; completing or
deleting the action before the scheduler runs suppresses the reminder.

## Service worker behavior

Extend the existing `/public/sw.js` rather than introducing another service
worker. Add:

- A `push` handler that displays a notification with Relay's icon, a stable tag
  for replacement/deduplication, and the deep-link URL in notification data.
- A `notificationclick` handler that closes the notification, focuses an
  existing Relay window if possible, and navigates it to the deep link;
  otherwise it opens a new window.
- A message path from the page to suppress OS presentation while the app is
  focused, if delivery infrastructure cannot determine visibility.

Use the task/run or owner-action identifier as the notification `tag` so a retry
does not stack duplicates. Badge API support may be used as progressive
enhancement, but the in-app unread count remains authoritative.

## API surface

Add authenticated owner endpoints:

- `GET /api/notifications?cursor=...` — paginated newest-first list and unread
  count.
- `PATCH /api/notifications/:id` — mark read.
- `POST /api/notifications/read-all` — mark all read.
- `GET/PATCH /api/notification-preferences` — read/update push categories.
- `POST /api/push-subscriptions` — validate and upsert the current endpoint.
- `DELETE /api/push-subscriptions` — disable the current endpoint.

All record IDs supplied by the client must be resolved under the authenticated
user; foreign keys alone are not authorization.

## Rollout

### Phase 1 — durable in-app notifications

1. Add notification schema, RLS, retention policy, and typed domain models.
2. Create exactly-once records for run completion and failure.
3. Add the bell, unread badge, notification center, read behavior, and deep
   links.
4. Reuse the existing foreground polling initially; fetch notifications when a
   live run changes and when the window regains focus.

This phase delivers value without browser permission or delivery-provider risk.

### Phase 2 — opt-in web push

1. Add VAPID configuration, subscription APIs, preferences, and service-worker
   push/click handlers.
2. Add contextual opt-in after the first queued run and settings management.
3. Deliver result-ready and failed-run pushes; validate installed-PWA behavior
   on iOS as well as Android and desktop browsers.

### Phase 3 — owner-action reminders

1. Add the scheduled reminder producer for due and unsnoozed actions.
2. Enable due reminders by default for push-enabled users; keep unsnooze push
   opt-in.
3. Add quiet hours or digesting only if usage shows reminder fatigue.

### Phase 4 — reliability refinements

Consider queued-too-long alerts, device management, real-time in-app updates,
and additional channels only after measuring the core handoffs.

## Validation and acceptance criteria

- Completing or failing a run creates exactly one in-app notification even if
  the worker retries the completion request.
- The unread badge updates while Relay is open and after returning to the app.
- Selecting a notification opens the exact task/action and marks it read.
- Push is never requested without an explicit user gesture.
- A push click focuses an existing Relay window when possible and reaches the
  correct detail on desktop, Android, and installed iOS PWA.
- A foreground Relay session does not receive a redundant OS notification.
- Disabled categories and disabled/expired endpoints receive no push.
- Due-time edits, completion, deletion, and snoozing cannot produce stale or
  duplicate reminders.
- Push payloads and logs contain no private task/result/error content.
- RLS and API tests prove one user cannot read, mark, subscribe to, or navigate
  another user's notification.
- Temporary delivery failures retry; permanent endpoint failures deactivate the
  subscription without affecting the in-app record.

Track notification creation-to-delivery latency, push success/failure by
platform, opt-in/blocked rates, click-through rate, time from result-ready to
review/accept, and duplicate suppression. The product is successful if owners
return to completed work faster without high disable rates or repeated alerts.

## Open decisions before implementation

1. Choose the server-side scheduler/delivery runtime (Vercel Cron plus an
   authenticated route, or Supabase scheduled/edge functions).
2. Set notification retention; 30 days is the recommended starting point.
3. Decide whether “snoozed action returns” belongs in Phase 3 at all after
   observing how often My Work snoozing is used.
4. Define the queued-too-long threshold before considering that later event;
   it should account for intentionally offline laptop workers.
