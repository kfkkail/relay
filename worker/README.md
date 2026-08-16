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

The recommended backend is your locally installed Codex CLI. It reuses your
ChatGPT/Codex login, so it does not require an OpenAI API key or API billing
balance. Authenticate Codex and GitHub as the same local user that will run the
worker:

```bash
codex login
codex login status
gh auth login
gh auth status
```

On a headless Raspberry Pi, use `codex login --device-auth`. Guided setup records
the absolute Codex executable path, your current command search path, and the one
directory the agent may change. Capturing the path ensures background workers
can still find Homebrew and user-installed tools. An optional `RELAY_CODEX_MODEL`
overrides the CLI default.

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

The API backend is text-only and declares no tools. The Codex backend launches
the installed `codex` executable directly as the local user, from the configured
workspace. That gives tasks the machine's normal Git, GitHub CLI, package
managers, language toolchains, network, credential helpers, and keychain access.

Relay starts `codex exec` with Codex's built-in `workspace-write` sandbox,
non-interactive approvals, and network access. Project files can only be changed
inside `RELAY_CODEX_WORKSPACE`; normal operating-system temporary directories
remain available so developer tools work. This is deliberately not
`danger-full-access`. User Codex configuration, web search, and custom execution
rules are ignored so they cannot silently widen the worker's permissions.

The worker token and API/database secrets are removed before Codex starts. Other
local environment and credential-helper access are preserved intentionally for
this personal, single-user worker. Tasks can inspect Actions, push, and create
pull requests with the existing `gh auth login` identity. External changes are
still prompt-governed: the worker policy tells Codex to make them only when the
task asks.

Only the run ID, status, and bounded error category are written to stdout; task
instructions, results, credentials, model responses, and raw Codex diagnostics
are not logged.

## Protocol

All endpoints use `Authorization: Bearer <worker token>`.

- `POST /api/worker/runs/claim` atomically claims the oldest queued run for the
  token owner, or returns `204` when no work is available.
- `POST /api/worker/runs/:id/complete` accepts a Markdown result and optional
  structured artifacts.
- `POST /api/worker/runs/:id/fail` records a bounded error message.

Software tasks can edit repositories and use GitHub from the configured
workspace today. Structured `branch`, `commit`, `pull_request`, and `check`
artifacts remain future work; current tasks return those details in Markdown.
