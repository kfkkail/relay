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
background service can find it. Setup also asks for one absolute workspace
directory. Codex can inspect and modify that directory and its descendants,
including changing into repositories below it. An optional `RELAY_CODEX_MODEL`
overrides the CLI default.

For authenticated Actions, pushes, and pull requests, create a fine-grained
GitHub token limited to the repositories and permissions Relay needs. Enter it
during guided setup or set it in `.env.worker`:

```bash
RELAY_GITHUB_TOKEN=github_pat_your-fine-grained-token
```

Relay passes this explicitly configured token to the sandboxed child as
`GH_TOKEN`. It never extracts or forwards the user's existing GitHub Keychain
credential. A normal `gh auth login` session may be inaccessible from a
workspace-only macOS sandbox, which is why the dedicated token is required for
reliable unattended GitHub operations.

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
task ephemerally from the configured workspace with a custom permission profile:
files outside that workspace are denied except for Codex's minimal runtime
files, common Homebrew and developer-tool locations are read-only, the workspace
and temporary directories are writable, command network access is enabled, and
environment files matching `.env` or `.env.*` remain denied. GitHub CLI and Git
account metadata are read-only. Web search and user configuration are disabled,
so access is determined by Relay's explicit worker configuration rather than a
user's normal Codex defaults. Relay and API credentials are removed from the
child process environment. GitHub authentication is the explicit exception:
only an intentionally configured `RELAY_GITHUB_TOKEN` is passed to the child as
`GH_TOKEN` so `gh` can operate without escaping the workspace sandbox.

Relay never starts Codex in `danger-full-access` mode and never approves an
escape from the workspace sandbox. Operations outside the configured workspace
are reported as limitations. Filesystem writes remain limited to the workspace
and temporary directories.

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

Software tasks can edit repositories and use GitHub from the allowlisted
workspace today. Structured `branch`, `commit`, `pull_request`, and `check`
artifacts remain future work; current tasks return those details in Markdown.
