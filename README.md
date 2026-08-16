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

Worker setup recommends containerized Codex CLI, which reuses `codex login` and
does not need an OpenAI API key. Each task gets a disposable container with only
the configured workspace mounted read-write. Codex can edit repositories, run
commands, use GitHub Actions, push branches, and create pull requests there,
without receiving access to the rest of the host. The direct OpenAI API backend
remains available for usage-based API billing.

The remaining cloud steps require your authorization:

1. Create a Supabase project and run [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql).
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

## Commands

```bash
npm run setup
npm run dev
npm run lint
npm run test
npm run build
npm run worker
npm run worker:image:build
npm run worker:service:install
```

See [`docs/implementation-plan.md`](docs/implementation-plan.md) for scope and
architecture, and [`worker/README.md`](worker/README.md) for the polling worker
protocol.
