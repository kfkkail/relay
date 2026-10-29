# Vehicles implementation progress

Approved specification: `/Users/kailkeusch/Documents/ChatGPT/car-research/PLAN.md`.
Implementation checkout: `/Users/kailkeusch/repos/relay-auto-dev-vehicles`.
Branch: `codex/auto-dev-vehicles`, based on `284e3a7` (`origin/main`).

## Checkpoints

- [x] Worker and Auto.dev collector: credential retrieval, typed normalized
      results, bounded pagination, retry, explicit coverage status, and fixtures.
- [x] Domain and ingestion: forward-only schema/RLS, durable decisions,
      deduplication, rule evaluation, scoring, and idempotent ingestion.
- [ ] Review interface: dropdown link, queues, cards/photos, swipe, undo,
      verification, settings, and coverage health.
- [ ] Relay integration and verification: Run Now, task lifecycle, notifications,
      disabled schedules, regression checks, and final handoff.

## Current work

Build started 2026-10-28. Auto.dev collector and Keychain credential helper are
implemented. `npm run vehicles:probe` runs a bounded, aggregate-only census with
no saved raw API output. The full suite passed 214 tests before the latest
photo/polling and notification refinements; TypeScript, lint and a production
build also passed. Embedded PostgreSQL tests execute all repository migrations
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

Finish UI browser verification with fixture data and capture desktop/mobile
screenshots. A temporary route `app/vehicles/preview/page.tsx` exists only for
that test: REMOVE IT before committing UI. The temporary browser harness is
`/private/tmp/relay-vehicles-db.oGEtnx/vehicles-browser.mjs`; it uses the existing
Playwright dependency from `relay-worker-playwright` and system Chrome. Local
test server is on 127.0.0.1:3217 (webpack with WATCHPACK_POLLING=1000 because
native file watchers failed). It is not a production server. After verification,
add migration pgTAP coverage/operational docs, rerun checks, and commit the UI and
integration checkpoints. Docker daemon is not running: full local Supabase
reset/lint/pgTAP remains unverified, though embedded PostgreSQL tests pass.
