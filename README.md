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
npm run worker:service:install
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
4. Sign in, create a token in **Worker setup**, and run
   `npm run worker:service:install` on the machine that will run the worker.

The web application and worker can use separate environment files or shell
sessions. Never put a real worker token, API key, task export, log, or database
dump in this repository.

To reject an existing worker token, open **Worker setup** and choose **Revoke
token** beside that worker. Revocation is permanent and blocks subsequent API
requests, including result submission for active runs. It does not stop a local
process already running. Create a new token and update the worker environment to
reconnect. Worker records are retained so existing run history remains intact.

## MacBook and Raspberry Pi workers

After cloning this repository on your MacBook or Pi, install Node.js 22 or newer,
Git, npm, and your chosen backend (the Codex CLI or an OpenAI API key). Create a
worker token in Relay's **Worker setup** panel, then run this one command in an
interactive terminal:

```bash
npm run worker:service:install
```

It runs guided worker setup automatically when `.env.worker` is missing or
incomplete, saves your settings, installs dependencies in a dedicated worker
clone, and starts the background service. Existing valid settings are reused.
You do not need to run `npm run setup` separately. If setup is cancelled or
fails, installation stops. Noninteractive installs require valid settings first.

Once setup and installation finish, the command exits and returns your shell
prompt. The worker runs independently in the background; you can close the
terminal or disconnect SSH. The installer does not keep streaming worker logs.

Check the service with:

```bash
npm run worker:service:status
```

To change settings later, run `npm run setup -- --mode worker`, then rerun
`npm run worker:service:install`. For a foreground-only worker, run that setup
command followed by `node --env-file=.env.worker worker/index.mjs`.

This installs a per-user LaunchAgent on macOS or a per-user systemd service on
Linux, including Raspberry Pi OS. On Linux, the installer verifies that systemd
lingering is enabled for the current user and enables it when necessary; the
one-time change may prompt for `sudo`. Lingering keeps the worker running after
the last SSH session closes and starts it at boot before login. Remove the
service without deleting its configuration or logs with
`npm run worker:service:uninstall`.

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

### Authentication redirects

Allow the exact production URL `https://YOUR_PRODUCTION_DOMAIN/auth/callback`
in Supabase Authentication → URL Configuration. Sign-in keeps its return
path in a ten-minute HTTP-only cookie, so query strings for tasks and filters
never change the OAuth callback URL. Existing callbacks with a `next` query
remain supported while deployments roll over. Failed or expired callbacks show
an error with a retry button instead of silently looping.

The Supabase Site URL should also be the production origin. This PR does not
change hosted auth settings; the exact callback allowlist entry is sufficient
for app-initiated sign-in. The Site URL remains relevant for default redirects
and other Supabase auth flows.
