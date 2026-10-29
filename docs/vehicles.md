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

On macOS the vehicle handler reads the login Keychain item with service
`com.relay.auto-dev.api-key`, account `relay-worker`. The item must be accessible
to the user running the background worker; a locked or inaccessible Keychain
produces a visible failure. On Linux, or for another secret manager, inject
`AUTODEV_API_KEY` into the worker environment. The key is removed before generic
Codex child processes start. Never place it in task payloads, browser settings,
fixtures, logs or tracked files.

`npm run vehicles:probe` performs an aggregate-only local census. It uses no Relay
or Supabase credentials and does not write inventory. It fetches at most 100
pages (20 records requested per page), with pacing, request timeouts and bounded
retries. It follows pagination links only on `api.auto.dev` and retains the
configured make/model filters. Photo galleries are fetched on demand through a
separate worker job so each scan does not consume a photo request for every VIN.
The API's gallery ordering does not establish an interior image: choose **Use as
interior photo** after viewing the gallery.

## Review behavior

Pass, Watch and Shortlist are global per vehicle. Passing a VIN suppresses it
across listings, future runs and profile changes. A passed provisional vehicle
retains its decision when the owner confirms its VIN and it merges into a
canonical record. Restore is an explicit owner action. Undo uses a decision
revision so it cannot overwrite a newer decision from another tab.

Unknown battery, VIN or complete acquisition cost goes to Needs Verification.
Adventure and Launch Edition alone do not establish a battery. Missing shipping
and fees are not zero; confirmed pickup removes shipping from the total. Missing
history is a warning and score penalty. Verification overrides persist through
future source updates. Review cards show 25 at a time, with the backlog reachable
through **Review next 25**, and session storage retains queue/batch position.

Manual import currently uses a URL plus an editable form; it does not fetch an
arbitrary seller URL. This keeps source credentials and SSRF out of the initial
Auto.dev implementation. Automatic URL extraction is deferred pending a
permitted-source collector. Gallery/photo failures fall back to the original
listing and placeholders.

## Coverage and completion

Auto.dev is the only required automatic source in this release. Dealer names
and destination domains describe observed inventory, not guaranteed upstream
marketplace coverage. Rivian, Carvana and CarMax were observed in local probes.
Edmunds, Autotrader, Cars.com, CarGurus, TrueCar and individual dealer sites remain
direct-collection targets, with manual-only access until separately assessed.
Logged-in marketplaces use manual entry. No direct scrapers are implemented.

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

Successful no-change searches remain silent. New eligible vehicles, watched
changes and material failures enqueue one digest per subscription/run. Vehicle
pushes open `/vehicles`; the generic completion push is suppressed. Photo-only
jobs complete silently.

## Verification and rollout gates

- `npm test` includes deterministic collector/rules tests and embedded PostgreSQL
  tests that apply all repository migrations. Supabase auth/storage and
  cron/network extensions are stubbed only in this embedded harness.
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, and `npm run build`
  verify the application.
- `supabase db reset`, `supabase db lint --level warning`, and `supabase test db`
  remain required against a local Supabase runtime or the existing CI workflow.
  The new `supabase/tests/vehicles.test.sql` tests owner isolation, job snapshots,
  legacy claims, lease fencing and atomic/idempotent ingestion there.
- Compare manually enumerated VIN samples from Rivian/Carvana/CarMax against the
  feed, confirm the account's storage/photo permissions and request allowance,
  resolve or document provider count discrepancies, and review the baseline
  before explicitly enabling the daily schedule.

This implementation is prepared locally. Remote migration, deploy, push/PR,
merge and schedule enablement are separate owner actions.
