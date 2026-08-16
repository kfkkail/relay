# Relay implementation plan

## First vertical slice

1. Establish a mobile-first Next.js App Router PWA with GitHub OAuth sign-in.
2. Persist tasks, runs, events, and workers in Supabase Postgres with row-level
   security and a one-active-run-per-task database constraint.
3. Support creating and editing Markdown task instructions, then queueing a run.
4. Let a local laptop worker authenticate with a revocable token and poll
   outbound for queued runs. Offline workers simply leave runs queued.
5. Run a text-only agent through the OpenAI API or a locally authenticated Codex
   CLI constrained to one configured workspace; return a Markdown result through
   the worker API.
6. Let the user review the result, add written feedback, queue another attempt,
   accept a result, and draft an editable child task from accepted output.
7. Preserve a concise event audit trail without modeling a chat transcript.
8. Validate types, lint, unit tests, production build, database policies, and
   public-repository hygiene before publishing a draft pull request.

## Architecture

- **Web:** Next.js 16 App Router, React 19, installable web manifest, and a
  conservative service worker that never caches authenticated pages or API
  responses.
- **Data and auth:** Supabase Postgres plus Supabase GitHub OAuth.
  This is the smallest choice that supplies cloud persistence, identity, and
  per-user row isolation without a second authentication vendor.
- **Worker connection:** authenticated HTTPS polling from the laptop to the
  deployed Next.js worker routes. The laptop exposes no inbound port.
- **Agent adapter:** selectable OpenAI Responses API or Codex CLI. The API path
  declares no tools. The Codex path disables web search and user configuration,
  removes Relay and API secrets from its environment, and uses Codex's built-in
  `workspace-write` sandbox for one explicitly configured workspace. Codex runs
  as the local user with normal installed command-line tools, command network
  access, and existing GitHub CLI authentication, while project writes remain
  workspace-only. Richer structured result artifacts remain a later slice.
- **Deployments:** Vercel's GitHub integration only. No Vercel API dependency.

## Deliberately deferred

File artifacts, structured GitHub result metadata, customizable workflows,
multiple concurrent agents, delegation, integrations, native iOS, and elaborate
boards are outside this increment.

## Blocking decisions

There are no product decisions blocking the scaffold. Before a deployed copy
can process real tasks, its owner must provide a Supabase project, configure the
documented environment values, and configure a GitHub OAuth App for sign-in.
Those are deployment inputs rather than code-design decisions.
