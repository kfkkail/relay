# iOS push notifications

Relay sends Web Push for completed and failed runs. On iOS 16.4 or later,
add Relay to the Home Screen, open the installed app, sign in, and select the
bell → Enable notifications. Use Send test notification to verify delivery.
Permission is requested only from the button tap. No Apple Developer account
or native app is needed. Android and desktop standards-based push also work.

## Deployment

1. Deploy the new migration through the existing migration workflow.
2. Run `npx web-push generate-vapid-keys` locally. Store the public key as
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the private key as `VAPID_PRIVATE_KEY`, and a
   contact such as `mailto:you@example.com` as `VAPID_SUBJECT` in the web host's
   environment. Generate a long random `CRON_SECRET` for the scheduler.
   Keep this key pair stable; rotating it requires devices to resubscribe.
3. Redeploy the application so the public key is included in its client bundle.
4. Configure a cloud scheduler to call `GET https://YOUR_RELAY_HOST/api/push/deliver`
   every minute with `Authorization: Bearer YOUR_CRON_SECRET`. Use a scheduler
   that supports secret headers, such as Supabase Cron with pg_net and Vault.
   Configure the URL and secret in that service, never in committed SQL or logs.
   Vercel Pro can alternatively use a `/api/push/deliver` cron entry with schedule
   `* * * * *`; Vercel supplies the configured CRON_SECRET header automatically.
   Vercel Hobby's daily cron limit is unsuitable for prompt notifications.
   No scheduler is created automatically by this PR.
5. On a physical iPhone, enable notifications, send a test, close Relay, and
   complete and fail test runs. Tap each notification and verify its task opens.
   Check Notification Center and Focus settings if no banner appears.

The endpoint returns 401 without the secret and 503 on configuration/database
failure or any terminal delivery failure in the last 24 hours. Responses after
processing include `processed` and `failedLast24Hours`; alert on a nonzero failure
count or repeated scheduler errors. Delivery continues even while this signal is
nonzero, so an empty subsequent batch does not hide a prior failure.
Without the scheduler, test pushes work but run notifications stay queued.
Cloud delivery does not require the laptop to remain online after finishing.

## Delivery behavior and limits

A database trigger inserts one outbox row per subscribed device and run outcome
in the same transaction as the status transition. Subscribing does not replay
old runs. Claims use row locks and a five-minute lease, allowing safe concurrent
scheduler calls and recovery after crashes. Each batch handles up to 20 devices.
Transient failures use exponential backoff, capped at six attempts and a 24-hour
age limit. `delivered_at` records provider acceptance; `failed_at` records terminal
failures, expired work, or abandoned final attempts after their lease expires.
`last_status_code` stores only an HTTP code (0 when unavailable), never response
bodies or credentials. Existing finished rows without these fields have unknown
outcomes, not presumed success. Provider 404/410 responses remove expired subscriptions. Outbox rows
are deleted after seven days. Delivery is at least once; stable notification tags
reduce duplicate presentation after a crash between sending and recording success.
A processed count indicates attempted work, not confirmed device presentation.

Subscription credentials are stored in server-only tables with RLS and revoked
client grants. API requests are authenticated and scoped to the current user.
The sender accepts only known browser push service hosts. Push content contains
generic text and task identifiers, never task titles, instructions, results, or
raw errors. Disable removes the subscription and pending deliveries for this
device, retaining completed outcome records. On mount, Relay reconciles an existing
browser subscription with the server before displaying it as enabled. A failed
reconciliation leaves enable/retry available and does not show a false enabled state. Sign-out does not automatically disable OS notifications; disable first
on a shared device. Another account cannot overwrite an existing subscription.

Every received push displays a notification, including while Relay is open;
Safari does not permit silent push handling. In-app history, category settings,
due-date reminders, and foreground filtering before sending are future work.

References: [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[Web Push sender](https://github.com/web-push-libs/web-push),
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
