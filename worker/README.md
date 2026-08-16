# Relay laptop worker

The worker makes outbound HTTPS requests to Relay. It never opens a listening
port, so an offline laptop simply leaves runs in the queue.

## Run it

Create a worker token in Relay's **Worker setup** panel, then run the guided
setup. It writes the selected backend settings to a gitignored,
owner-readable-only `.env.worker` file:

```bash
npm run setup -- --mode worker
```

The recommended backend is Codex CLI. It reuses a local ChatGPT/Codex login, so
it does not require an OpenAI API key or API billing balance:

```bash
codex login
codex login status
```

On a headless Raspberry Pi, use `codex login --device-auth`. Relay requires
Codex CLI 0.138.0 or newer and records its absolute executable path so the
background service can find it. An optional `RELAY_CODEX_MODEL` overrides the
CLI default.

The OpenAI Responses API remains available by choosing it during setup or by
setting `RELAY_WORKER_BACKEND=openai`; that backend still requires
`OPENAI_API_KEY`.

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

The API backend is text-only and declares no tools. The Codex backend runs each
task ephemerally in a new temporary directory with a custom least-privilege
permission profile: filesystem reads are denied outside Codex's minimal runtime
files and the empty task directory, writes and command network access are
disabled, web search and user configuration are disabled, and approvals are
never granted. Relay and API credentials are removed from the child process
environment. The temporary directory is deleted after every run.

Only the run ID, status, and bounded error category are written to stdout;
task instructions, results, credentials, model responses, and raw Codex
diagnostics are not logged.

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
