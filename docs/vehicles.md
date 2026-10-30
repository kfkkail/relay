# Vehicles: Auto.dev rollout and operations

Vehicles lives at `/vehicles`, reached through Relay's settings dropdown. The
default R1T search is nationwide from ZIP 46530, with a $70,000 effective-cost
ceiling and an explicit Large/Max battery requirement. The daily 7 AM Indianapolis
schedule is created disabled. Start with **Create vehicle search**, then **Run
Now** once the database, web API and a compatible worker are deployed.

## Worker setup

After deploying migration `20261029000000_vehicle_search.sql` and its matching
web routes, set `RELAY_VEHICLE_SEARCH=1` in the worker's protected configuration
and restart the worker. Its normal Relay URL/token and backend settings remain
required. Older workers continue claiming only generic agent tasks.

The workers are Linux-only. Inject `AUTODEV_API_KEY` into the worker service's
protected environment or its owner-readable `.env.worker` file (permissions
`0600`). There is no OS credential-store fallback or credential subprocess;
a missing or blank key produces a visible configuration failure. The key is
removed before generic Codex child processes start. Never place it in task
payloads, browser settings, fixtures, logs or tracked files.

To run the local probe with that file rather than an already-injected process
environment, use `node --env-file=.env.worker scripts/vehicles-probe.mjs`.

`npm run vehicles:probe` performs an aggregate-only local census. It uses no Relay
or Supabase credentials and does not write inventory. It fetches at most 100
pages (20 records requested per page), with pacing, request timeouts and bounded
retries. It follows pagination links only on `api.auto.dev` and retains the
configured make/model filters. Photo galleries are fetched on demand through a
separate worker job so each scan does not consume a photo request for every VIN.
The API's gallery ordering does not establish an interior image: choose **Use as
interior photo** after viewing the gallery.

After the inventory scan, the worker checks up to 20 unresolved R1T seller pages
for explicit battery labels, cheapest and lowest-mileage first. Set
`RELAY_VEHICLE_DETAIL_LIMIT` from 0 to 50 to change or disable that bounded pass.
Requests have a ten-second timeout, a 1.5 MB response limit, no cookies or API
credentials, manual redirect validation, and public-address DNS checks. Exact
Large, Max, Standard or Standard+ evidence is cached by VIN in the managed
worker's ignored `.relay/vehicle-enrichment.json`; unresolved pages rotate behind
untried candidates on later scans. Dual/Quad/Tri is captured opportunistically
but is never required for the initial profile.

This review-funnel change requires no database migration or backfill. Existing
listing JSON is re-evaluated by the application immediately, and the next search
upserts any newly enriched battery or motor facts for the same VINs.

Choosing Interested or Shortlist automatically queues the existing deduplicated
Auto.dev photo job when the source reports more images than Relay currently has.
The review decision succeeds even if that optional job cannot be queued, and the
gallery retains its manual retry button. Photo jobs complete silently and never
change inventory coverage health.

## Local interactive preview

For visual review without a database or Auto.dev key, start the development
server with `RELAY_VEHICLES_PREVIEW=1 npm run dev` and open `/vehicles/preview`
at its printed local URL. The page uses the actual Vehicles interface with a
separate in-memory transport. Decisions, Undo, gallery selection, verification
and profile edits are interactive and reset on reload. Searches, scheduling,
inventory imports and global account actions are disabled.

This route requires both development mode and the explicit preview flag. It
always returns 404 in production, even if the flag is accidentally configured.
Sample vehicle data is fictitious; licensed illustrative photographs and their
attribution are in `public/vehicles-demo/`. No API key is needed or read.

## Review behavior

Pass, Interested and Shortlist are global per vehicle. The internal durable
value for Interested remains `watch` for backward compatibility. Passing a VIN
suppresses it across listings, future runs and profile changes. A passed provisional vehicle
retains its decision when the owner confirms its VIN and it merges into a
canonical record. Restore is an explicit owner action. Undo uses a decision
revision so it cannot overwrite a newer decision from another tab.

Unknown battery or VIN goes to Needs Verification. Adventure and Launch Edition
alone do not establish a battery. Missing shipping and fees are not zero, but
they no longer block initial review: the card shows a warning, ranking uses the
advertised price with reduced confidence, and full cost should be confirmed for
an Interested or Shortlist candidate. Confirmed pickup removes shipping from the total.
Missing history is a warning and score penalty. Verified battery/history facts follow
the vehicle through source updates; newly reported excluded titles always win
over an earlier clean-title confirmation. Shipping, fees, delivery, a confirmed
missing-price fallback, and the selected interior photo are scoped to the
listing ID, seller identity and URL. A seller/URL change requires fresh cost
verification. A later advertised source price takes precedence over the fallback.
Gallery selection patches only the photo, not stale verification form fields.
Review cards show 25 at a time, with the backlog reachable
through **Review next 25**, and session storage retains queue/batch position.
Vehicles shares Relay's header and controls with Schedules. Desktop uses queue
pills; mobile uses a queue selector so none of the states are clipped off-screen.
Secondary facts and corrections are under **Details & sources**. Pass,
Interested and Shortlist use explicit review buttons; card swipes never change
review state.
Passed cards expose an explicit Restore action rather than normal review actions.

## Guarded bulk pass

Use the maintenance script when a large, precisely defined group of review
cards should be passed. It uses the same evaluator as the Vehicles screen and
connects to Supabase with `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SECRET_KEY` from `.env.local` or the process environment.

The command is dry-run by default:

```sh
npm run vehicles:bulk-pass -- --user-email owner@example.com --max-score 56 --min-distance 500
```

Review the candidates and the printed count. Applying requires that exact count
to still match a fresh evaluation; stale decision revisions are skipped:

```sh
npm run vehicles:bulk-pass -- --user-email owner@example.com --max-score 56 --min-distance 500 --apply --confirm-count 116
```

The script only selects unreviewed vehicles whose current eligibility is
`needs_verification`, whose distance is known, and whose score and distance
meet both thresholds. It does not require a database migration.

Manual import currently uses a URL plus an editable form; it does not fetch that
URL. The worker's separate Auto.dev enrichment pass reads only provider-returned
public seller pages under the bounded network controls above. Failed or blocked
pages remain unresolved and never become evidence. Gallery/photo failures fall
back to the original listing and placeholders.

## Coverage and completion

Auto.dev is the only required automatic source in this release. Dealer names
and destination domains describe observed inventory, not guaranteed upstream
marketplace coverage. Rivian, Carvana and CarMax were observed in local probes.
Edmunds, Autotrader, Cars.com, CarGurus, TrueCar and individual dealer sites remain
direct-collection targets, with manual-only access until separately assessed.
Logged-in marketplaces use manual entry. No logged-in or source-specific scraper
is implemented; the optional detail pass reads only public seller HTML for exact
configuration labels and does not attempt to bypass access controls.

The 2026-10-28 collector probe used 28 requests in 118 seconds: 547 reported,
544 unique VINs enumerated, no invalid/duplicate VINs. It correctly returned
Partial. Explicit battery labels were 21 Max, 9 Large, 46 Standard+, 43 Standard,
425 unknown. Source `updatedAt` was absent. Treat `createdAt` as source creation
time only, never as freshness evidence. Auto.dev's count discrepancy remains
unresolved; the earlier 543 result is not evidence of a complete source census.

Normalized batches are staged and finalized transactionally. Identical uploads
and repeated finalization are safe. A complete healthy run moves its task to
done, including zero-result/no-change runs. Partial, blocked or failed collection
leaves waiting and records Coverage Health. Only complete successful enumerations
advance absence counters, and two absences are required to mark a listing
unavailable. A 15-minute expired lease can be reclaimed; each new claim fences
out the prior token. Generic tasks are never retried by this mechanism.

Successful no-change searches remain silent. New eligible vehicles, changes to
Interested vehicles and material failures enqueue one digest per subscription/run. Vehicle
pushes open `/vehicles`; the generic completion push is suppressed. Photo-only
jobs complete silently.
Optional photo failures leave their own task waiting without changing inventory
coverage health, absence counters or digest counts. Vehicle ingestion and
heartbeat requests have a 30-second timeout with bounded upload retries.

The baseline guard is enforced in the database, including edits through the
shared Schedules screen. Make/model/origin ZIP changes disable daily searches
until a successful baseline for that collection scope and an explicit enable.
Scoring-only edits preserve an already-enabled schedule.

## Verification and rollout gates

- `npm test` includes deterministic collector/rules tests and embedded PostgreSQL
  tests that apply all repository migrations. Supabase auth/storage and
  cron/network extensions are stubbed only in this embedded harness.
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, and `npm run build`
  verify the application.
- Final local review, Linux-only credentials and visual alignment passed 249 tests on
  2026-10-29, including missing/blank credential checks, HTTP verification
  patches, seller-context changes, VIN-merge confirmations, optional-photo
  failures and shared-schedule baseline enforcement. Desktop/mobile fixture
  checks also exercised provisional (no-VIN) gallery selection and missing-price
  verification; the visual pass repeated shared navigation, mobile queue access,
  review buttons, Undo, dark mode and 320px layout. Screenshots are in `docs/vehicles-qa/`; they show fixture data,
  not live feed coverage or a deployed database.
- `supabase db reset`, `supabase db lint --level warning`, and `supabase test db`
  remain required against a local Supabase runtime or the existing CI workflow.
  The new `supabase/tests/vehicles.test.sql` tests owner isolation, job snapshots,
  legacy claims, lease fencing and atomic/idempotent ingestion there.
- Compare manually enumerated VIN samples from Rivian/Carvana/CarMax against the
  feed, confirm the account's storage/photo permissions and request allowance,
  resolve the provider count discrepancy sufficiently to produce a successful
  baseline, and review it before explicitly enabling the daily schedule. The
  currently Partial census does not satisfy the baseline guard.

This implementation is published in draft PRs #85 and #86. Merge, production
deployment, remote migration and schedule enablement remain separate owner
actions.
