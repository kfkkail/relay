# iOS push notifications

Relay sends Web Push for completed and failed runs. On iOS 16.4 or later,
add Relay to the Home Screen, open the installed app, sign in, and select the
bell → Enable notifications. Use Send test notification to verify delivery.
Permission is requested only from the button tap. No Apple Developer account
or native app is needed. Android and desktop standards-based push also work.

## iOS banner attribution

The “from Relay” line beneath the notification title is supplied by iOS to
identify the installed web app. It is not part of Relay's notification title or
message. Relay supplies the title and body in `lib/push.ts`, and `public/sw.js`
passes them to `showNotification` without adding an attribution line.

The Web Notifications API has no supported option to hide this system attribution.
Changing the task title or result preview will not remove it. Keep the app's name
intact in the manifest; renaming the app is not a supported way to suppress the
attribution. The exact banner layout can vary by iOS version.

Reference: [Notification options](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification#parameters).

## Deployment

1. Deploy the new migration through the existing migration workflow.
2. Run `npx web-push generate-vapid-keys` locally. Store the public key as
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the private key as `VAPID_PRIVATE_KEY`, and a
   contact such as `mailto:you@example.com` as `VAPID_SUBJECT` in the web host's
   environment. Generate a long random `CRON_SECRET` for the scheduler.
   Keep this key pair stable; rotating it requires devices to resubscribe.
3. Redeploy the application so the public key is included in its client bundle.
4. The migration installs Supabase Cron job `relay-push-delivery`, running every
   minute. It sends no requests until both Vault entries exist:
   - `relay_push_delivery_url`: the production HTTPS URL ending in `/api/push/deliver`.
   - `relay_push_cron_secret`: exactly the production Vercel `CRON_SECRET`.
     Add these values using Supabase Vault's Secrets UI after Vercel is deployed.
     The job reads Vault at execution time; credentials never appear in the cron
     command or committed SQL. Keep preview databases unconfigured. No Vercel cron
     job or Vercel plan upgrade is needed.
5. On a physical iPhone, enable notifications, send a test, close Relay, and
   complete and fail test runs. Tap each notification and verify its task opens.
   Check Notification Center and Focus settings if no banner appears.

The endpoint returns 401 without the secret and 503 on configuration/database
failure or any terminal delivery failure in the last 24 hours. Responses after
processing include `processed` and `failedLast24Hours`; alert on a nonzero failure
count or repeated scheduler errors. Delivery continues even while this signal is
nonzero, so an empty subsequent batch does not hide a prior failure.
Without the Vault values, test pushes work but run notifications stay queued.
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
the task title (up to 100 characters), a plain-text preview of the completed
result (up to 180 characters), and task identifiers. These may appear on the
lock screen according to device notification settings. Failed runs show the task
title and a prompt to review details, never raw errors. Empty titles or results
use fallback copy. Each preview comes from the run that triggered the notification. Disable removes the subscription and pending deliveries for this
device, retaining completed outcome records. On mount, Relay reconciles an existing
browser subscription with the server before displaying it as enabled. A failed
reconciliation leaves enable/retry available and does not show a false enabled state. Signing out removes this device’s server subscription and pending deliveries,
unsubscribes in the browser, and ends only the current session. Other devices stay
signed in and subscribed. An HTTP-only device cookie also allows server-side cleanup
when the sign-out form is submitted without JavaScript. Cleanup failures keep the
session open so the user can retry. Already submitted OS notifications cannot be
recalled. Signing back in requires enabling notifications again after browser
unsubscription. Another account cannot overwrite an existing subscription.

Every received push displays a notification, including while Relay is open;
Safari does not permit silent push handling. In-app history, category settings,
due-date reminders, and foreground filtering before sending are future work.

References: [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[Web Push sender](https://github.com/web-push-libs/web-push),
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Scheduler verification

After deployment, inspect `relay-push-delivery` in Supabase Cron. A successful
Cron execution only means the HTTP request was queued; verify the corresponding
response in `net._http_response` has status 200. HTTP 503 is the delivery health
signal described above. Monitor both failed responses and missing minute ticks.
The job can be paused from Supabase Cron without changing application code.
