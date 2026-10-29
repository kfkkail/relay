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
- [ ] Relay integration and verification: Run Now, task lifecycle, notifications,
      disabled schedules, regression checks, and final handoff.

## Current work

Build started 2026-10-28. Auto.dev collector and Keychain credential helper are
implemented. `npm run vehicles:probe` runs a bounded, aggregate-only census with
no saved raw API output. The full suite passes 221 tests, including final history
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

## Next step

Desktop/mobile browser checks pass with fixtures: photos, Pass/Undo, Passed
after refresh, Watch, required-data verification, coverage warnings, profile
re-evaluation preserving Watch, keyboard focus trapping/Escape, and mobile
overflow. No page errors. Screenshots are in `docs/vehicles-qa/` (fixture images,
not real inventory). The temporary preview route has been removed and the local
test server stopped. Operations are documented in `docs/vehicles.md`; actual
Supabase pgTAP assertions are in `supabase/tests/vehicles.test.sql`.

The UI and integration checkpoint commits are being saved. Perform a final code review
against the approved plan, concentrating on cross-layer behavior rather than
re-running completed tests without changes. Run Now, task completion, meaningful digest enqueueing,
photo jobs and disabled schedule controls are implemented and locally tested;
the last checkbox stays open until the integration verification is accounted for.
Docker daemon is not running: full Supabase
reset/lint/pgTAP remains unverified, though embedded PostgreSQL tests pass. The
initial manual Rivian/Carvana/CarMax VIN comparison and subscription-specific
storage/photo permissions remain rollout verification, as does the Auto.dev
count mismatch. Direct URL extraction is intentionally deferred; manual import
uses an editable form and performs no seller-page network fetch.

The last clean production build contains `/vehicles`, owner APIs, and the
vehicle-worker result route. No unauthenticated preview route remains. The
temporary browser server is stopped. Browser fixture screenshots are evidence
of the UI only, not of a production database rollout or inventory completeness.
