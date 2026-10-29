# Vehicles implementation progress

Approved specification: `/Users/kailkeusch/Documents/ChatGPT/car-research/PLAN.md`.
Implementation checkout: `/Users/kailkeusch/repos/relay-auto-dev-vehicles`.
Branch: `codex/auto-dev-vehicles`, based on `284e3a7` (`origin/main`).

## Checkpoints

- [ ] Worker and Auto.dev collector: credential retrieval, typed normalized
      results, bounded pagination, retry, explicit coverage status, and fixtures.
- [ ] Domain and ingestion: forward-only schema/RLS, durable decisions,
      deduplication, rule evaluation, scoring, and idempotent ingestion.
- [ ] Review interface: dropdown link, queues, cards/photos, swipe, undo,
      verification, settings, and coverage health.
- [ ] Relay integration and verification: Run Now, task lifecycle, notifications,
      disabled schedules, regression checks, and final handoff.

## Current work

Build started 2026-10-28. Auto.dev collector and Keychain credential helper are
implemented. The first 19 collector tests pass. `npm run vehicles:probe` runs a
bounded, aggregate-only census with no saved raw API output. The primary Relay checkout has unrelated branch work;
all Vehicles edits belong in this checkout. No remote migration, deployment,
push, PR, or schedule enablement is authorized. Auto.dev access is stored in
macOS Keychain under service `com.relay.auto-dev.api-key`, account `relay-worker`.
Never print or store the credential in project files.

## Next step

Add typed ingestion validation, database schema, and worker capability routing.
Docker is installed but its daemon is not running, so local Supabase tests need
an available runtime; continue application and fixture checks in the meantime.
