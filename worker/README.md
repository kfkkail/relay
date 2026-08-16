# Relay laptop worker

The worker makes outbound HTTPS requests to Relay. It never opens a listening
port, so an offline laptop simply leaves runs in the queue.

## Run it

Create a worker token in Relay's **Worker setup** panel, then set the worker-only
values listed in `.env.example` in your local shell or secret manager. The
guided setup writes them to a gitignored, owner-readable-only `.env.worker`
file:

```bash
npm run setup -- --mode worker
```

Start the poller in the foreground with:

```bash
node --env-file=.env.worker worker/index.mjs
```

Or install and start the native background service on macOS or Linux (including
Raspberry Pi OS):

```bash
npm run worker:service:install
```

`npm run worker` remains available when the required values are already
exported into the current shell or supplied by another secret manager.

The initial adapter calls the OpenAI Responses API with text input and text
output. It declares no tools and has no Relay code path for shell, filesystem,
browser, GitHub, or repository access. Only the run ID and status are written to
stdout; task instructions, results, credentials, and model responses are not
logged.

## Protocol

All endpoints use `Authorization: Bearer <worker token>`.

- `POST /api/worker/runs/claim` atomically claims the oldest queued run for the
  token owner, or returns `204` when no work is available.
- `POST /api/worker/runs/:id/complete` accepts a Markdown result and optional
  structured artifacts.
- `POST /api/worker/runs/:id/fail` records a bounded error message.

A later software-work adapter can return `branch`, `commit`, `pull_request`, and
`check` artifacts. It must add an explicit local repository allowlist before it
receives any filesystem or process capability.
