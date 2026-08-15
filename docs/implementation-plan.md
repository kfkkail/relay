# Relay implementation plan

## First vertical slice

1. Establish a mobile-first Next.js App Router PWA with passwordless sign-in.
2. Persist tasks, runs, events, and workers in Supabase Postgres with row-level
   security and a one-active-run-per-task database constraint.
3. Support creating and editing Markdown task instructions, then queueing a run.
4. Let a local laptop worker authenticate with a revocable token and poll
   outbound for queued runs. Offline workers simply leave runs queued.
5. Run a text-only agent with no tools, shell, repository, or filesystem access;
   return a Markdown result through the worker API.
6. Let the user review the result, add written feedback, queue another attempt,
   accept a result, and draft an editable child task from accepted output.
7. Preserve a concise event audit trail without modeling a chat transcript.
8. Validate types, lint, unit tests, production build, database policies, and
   public-repository hygiene before publishing a draft pull request.

## Architecture

- **Web:** Next.js 16 App Router, React 19, installable web manifest, and a
  conservative service worker that never caches authenticated pages or API
  responses.
- **Data and auth:** Supabase Postgres plus Supabase passwordless email auth.
  This is the smallest choice that supplies cloud persistence, identity, and
  per-user row isolation without a second authentication vendor.
- **Worker connection:** authenticated HTTPS polling from the laptop to the
  deployed Next.js worker routes. The laptop exposes no inbound port.
- **Agent adapter:** OpenAI Responses API, text output only and no tools. A later
  slice can add repository work behind an explicit repository allowlist and
  richer result artifacts.
- **Deployments:** Vercel's GitHub integration only. No Vercel API dependency.

## Deliberately deferred

Repository mutation, GitHub PR creation by the worker, file artifacts,
customizable workflows, multiple concurrent agents, delegation, integrations,
native iOS, and elaborate boards are outside this increment.

## Blocking decisions

There are no product decisions blocking the scaffold. Before a deployed copy
can process real tasks, its owner must provide a Supabase project, configure the
documented environment values, and choose the email address used for sign-in.
Those are deployment inputs rather than code-design decisions.
