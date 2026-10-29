# Vehicles implementation progress

Approved specification: `/Users/kailkeusch/Documents/ChatGPT/car-research/PLAN.md`.
Implementation checkout: `/Users/kailkeusch/repos/relay-auto-dev-vehicles`.
Branch: `codex/auto-dev-vehicles`, based on `284e3a7` (`origin/main`).

## Checkpoints

- [x] Worker and Auto.dev collector: credential retrieval, typed normalized
      results, bounded pagination, retry, explicit coverage status, and fixtures.
- [x] Domain and ingestion: forward-only schema/RLS, durable decisions,
      deduplication, rule evaluation, scoring, and idempotent ingestion.
- [x] Review interface: dropdown link, queues, cards/photos, swipe, undo,
      verification, settings, and coverage health.
- [x] Local Relay integration and verification: Run Now, task lifecycle,
      notifications, disabled schedules, regression checks and final review.
- [ ] External rollout verification: real Supabase reset/lint/pgTAP, source VIN
      sample comparison and account-specific storage/photo permissions.

## Current work

Build started 2026-10-28. Auto.dev collector and Keychain credential helper are
implemented. `npm run vehicles:probe` runs a bounded, aggregate-only census with
no saved raw API output. The full suite passes 236 tests, including final history
normalization and title-conflict tests; TypeScript, lint and formatting pass. A clean
production build passes after removing the temporary browser preview route and
its stale generated Next.js development types. Embedded PostgreSQL tests execute
all repository migrations
with stubs for Supabase auth/storage and cron/network extensions, and test
capability-aware claiming, immutable profile snapshots, idempotent finalization,
VIN suppression, absence handling, owner isolation and lease fencing.

The new live collector census completed in 118 seconds, using 28 API requests:
547 reported, 544 unique VINs enumerated, zero invalid/duplicate VINs. Status is
correctly Partial due to count mismatch. Battery labels: 425 unknown, 46
Standard+, 43 Standard, 21 Max, 9 Large. No source freshness timestamps were
present. Do not mark that provider discrepancy resolved without evidence.

The primary Relay checkout has unrelated branch work;
all Vehicles edits belong in this checkout. No remote migration, deployment,
push, PR, or schedule enablement is authorized. Auto.dev access is stored in
macOS Keychain under service `com.relay.auto-dev.api-key`, account `relay-worker`.
Never print or store the credential in project files.

## Final review — 2026-10-29

Fixed demonstrated cross-layer defects without adding another collector:

- Listing/seller-scoped cost and interior-photo confirmations no longer follow
  a VIN onto a different seller or URL. The database atomically merges patches,
  rechecks the current stored context and retains confirmations through VIN
  merges. Legacy unscoped costs are ignored and removed on the next verification.
- Selecting an interior image cannot overwrite battery, history or cost details
  from a stale gallery. Provisional gallery actions use the record ID, not a null
  VIN. A missing advertised price can be confirmed without freezing future feed
  prices.
- The database guards daily schedule enablement even through shared Schedules.
  Collection-scope edits disable it; a fresh matching successful baseline and
  explicit owner enablement are required. Ranking-only edits preserve it.
- Owner and worker vehicle JSON requests enforce byte limits while streaming,
  independent of Content-Length. Vehicle Relay requests have 30-second timeouts.
  Optional photo-job failures remain on their own tasks, not as inventory
  coverage failures or digests.

All 236 tests pass, as do lint, formatting, TypeScript and the production build.
The embedded PostgreSQL suite now has 16 integration tests. Browser checks were
repeated after these fixes, including scoped photo selection, two provisional
vehicles with null VINs and missing-price verification (including editing the
confirmation again), with no page errors.

## Handoff and remaining gates

Desktop/mobile browser checks pass with fixtures: photos, Pass/Undo, Passed
after refresh, Watch, required-data verification, coverage warnings, profile
re-evaluation preserving Watch, keyboard focus trapping/Escape, and mobile
overflow. No page errors. Screenshots are in `docs/vehicles-qa/` (fixture images,
not real inventory). The temporary preview route has been removed and the local
test server stopped. Operations are documented in `docs/vehicles.md`; actual
Supabase pgTAP assertions are in `supabase/tests/vehicles.test.sql`.

Run Now, task completion, meaningful digest enqueueing, photo jobs and disabled
schedule controls are implemented and locally tested. Final cross-layer review
is complete. No further live Auto.dev census was needed in this review.
Docker daemon is still unavailable and no alternative local container runtime
was found: full Supabase
reset/lint/pgTAP remains unverified, though embedded PostgreSQL tests pass. The
initial manual Rivian/Carvana/CarMax VIN comparison and subscription-specific
storage/photo permissions remain rollout verification, as does the Auto.dev
count mismatch. Direct URL extraction is intentionally deferred; manual import
uses an editable form and performs no seller-page network fetch.

Next owner-controlled step: make an isolated local Supabase runtime available,
then run reset/lint/pgTAP and perform the small manual source comparison before
authorizing rollout. Do not point reset at any existing unrelated database.
The overnight build automation can now be paused: local implementation is
complete, with external rollout gates explicitly outstanding. Nothing has been
pushed, deployed, remotely migrated or enabled for daily inventory searches.

The last clean production build contains `/vehicles`, owner APIs, and the
vehicle-worker result route. No unauthenticated preview route remains. The
temporary browser server is stopped. Browser fixture screenshots are evidence
of the UI only, not of a production database rollout or inventory completeness.
