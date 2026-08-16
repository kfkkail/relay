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
- a text-only OpenAI worker adapter with no tools, shell, or repository access

## Local setup

1. Create a Supabase project and run [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql).
2. Copy `.env.example` to `.env.local` and replace the placeholder values.
3. Run `npm install`, then `npm run dev`.
4. Sign in, create a worker token in **Worker setup**, and keep the token somewhere secure.
5. On the laptop, set the worker-only environment variables shown in `.env.example`, then run `npm run worker`.

The web application and worker can use separate environment files or shell
sessions. Never put a real worker token, API key, task export, log, or database
dump in this repository.

## Deployment

Connect this GitHub repository to Vercel and configure the web environment
variables there. GitHub pushes and pull requests drive Vercel deployments;
Relay does not call Vercel APIs directly.

## Commands

```bash
npm run dev
npm run lint
npm run test
npm run build
npm run worker
```

See [`docs/implementation-plan.md`](docs/implementation-plan.md) for scope and
architecture, and [`worker/README.md`](worker/README.md) for the polling worker
protocol.
