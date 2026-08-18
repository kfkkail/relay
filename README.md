# Relay

Relay is a mobile-first personal task system where the durable object is a task,
not a chat. Write Markdown instructions on your phone, queue work for a local
laptop worker, review the result, send feedback, and turn accepted work into a
follow-up task.

This repository contains the first vertical slice:

- Next.js App Router PWA
- Supabase Postgres persistence and GitHub OAuth authentication
- one active run per task
- outbound polling by a separate local worker
- Markdown results, feedback, acceptance, and follow-up task lineage
- selectable Codex CLI and OpenAI API worker backends

## Local setup

Relay requires Node.js 22 or newer. After cloning the repository, run the guided
setup:

```bash
npm run setup
```

The command checks Node.js, installs the locked dependencies, and creates the
owner-readable-only environment files you select. Configure the web application
first, then configure the worker after Relay is running and can create its
token:

```bash
npm run setup -- --mode web
npm run setup -- --mode worker --install-service
```

Worker setup recommends the locally installed Codex CLI, which reuses your
`codex login` and does not need an OpenAI API key. It runs as your user with the
same installed command-line tools and GitHub CLI login, while Codex's native
`workspace-write` sandbox limits project changes to one configured directory.
Codex can edit repositories, run commands, inspect GitHub Actions, push branches,
and create pull requests from that workspace. The direct OpenAI API backend
remains available for usage-based API billing.

The remaining cloud steps require your authorization:

1. Create a Supabase project and deploy the committed migrations as described
   under [Database migrations](#database-migrations).
2. Run `npm run dev`, or deploy the repository to Vercel using the three web
   values written to `.env.local`.
3. Add the deployed URL and `/auth/callback` URL to the Supabase Auth redirect
   URL allowlist.
4. Sign in, create a token in **Worker setup**, and run the worker setup command.

The web application and worker can use separate environment files or shell
sessions. Never put a real worker token, API key, task export, log, or database
dump in this repository.

## MacBook and Raspberry Pi workers

Test the configured worker in the foreground with:

```bash
node --env-file=.env.worker worker/index.mjs
```

Install it as a background service that restarts automatically:

```bash
npm run worker:service:install
npm run worker:service:status
```

This installs a per-user LaunchAgent on macOS or a per-user systemd service on
Linux, including 64-bit Raspberry Pi OS. On a headless Raspberry Pi, the setup
prints the one optional administrator command needed to start the user service
at boot before login. Remove the service without deleting its configuration or
logs with `npm run worker:service:uninstall`.

## Deployment

Connect this GitHub repository to Vercel and configure the web environment
variables there. GitHub pushes and pull requests drive Vercel deployments;
Relay does not call Vercel APIs directly.

### Database migrations

Create schema changes with `supabase migration new <description>` and commit the
generated timestamped migration. Do not edit a migration after it has reached
production, and do not make production schema changes through Supabase Studio
or the SQL Editor. Use a new forward-fix migration instead.

Pull requests that change `supabase/config.toml` or `supabase/migrations/` reset
a fresh local Supabase database, lint its schema, and run the application tests.
Merges to `main` deploy pending migrations through the protected GitHub
`production` environment. Vercel deploys independently, so migrations and
application changes must remain backward compatible using an expand/contract
rollout when sequencing matters.

Before enabling production deployment, create the `production` GitHub
environment and add these environment secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID`

Require the migration validation check in branch protection. An environment
approval rule is recommended for the first few production migrations. The
deployment workflow can also be started manually for recovery.

For an existing project, first run `supabase migration list` against production
and confirm its schema and migration history match the committed migrations.
Only use `supabase migration repair` after separately verifying that the schema
already contains the migration; repair changes migration tracking, not schema.

## Commands

```bash
npm run setup
npm run dev
npm run lint
npm run test
npm run build
npm run worker
npm run worker:service:install
```

See [`docs/implementation-plan.md`](docs/implementation-plan.md) for scope and
architecture, and [`worker/README.md`](worker/README.md) for the polling worker
protocol.
