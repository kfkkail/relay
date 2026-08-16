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

The recommended backend is Codex CLI in Docker. It reuses a local ChatGPT/Codex
login, so it does not require an OpenAI API key or API billing balance. Install
and start Docker first, then authenticate Codex on the host:

```bash
codex login
codex login status
```

On a headless Raspberry Pi, use `codex login --device-auth`. Guided setup checks
the Docker service, records the absolute authentication file and allowed
workspace, and builds the pinned worker image. You can rebuild it explicitly:

```bash
npm run worker:image:build
```

The included image contains Codex CLI, Git, GitHub CLI, Node.js, Python, common
build tools, and command-line utilities. A custom image can extend it with a
repository-specific toolchain and be selected with `RELAY_CODEX_IMAGE`. An
optional `RELAY_CODEX_MODEL` overrides the CLI default.

For authenticated Actions, pushes, and pull requests, create a fine-grained,
revocable GitHub token limited to the repositories and permissions Relay needs.
Enter it during guided setup or set it in `.env.worker`:

```bash
RELAY_GITHUB_TOKEN=github_pat_your-fine-grained-token
```

For a worker that can ship normal repository changes, select only the intended
repositories and grant **Contents: read/write** and **Pull requests:
read/write**. Add **Actions: read/write** for workflow logs, dispatches, and
reruns. Add **Workflows: read/write** only when Relay should be able to change
files under `.github/workflows`. Do not grant repository administration or
organization permissions. GitHub maintains the full
[fine-grained permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

Relay passes that value as `GH_TOKEN`; it never extracts the user's existing
GitHub Keychain credential. Setup also records Git commit name and email without
mounting the host Git configuration.

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

The API backend is text-only and declares no tools. The Codex backend uses a
disposable container as the security boundary. The host mounts only the
configured workspace read-write and the Codex authentication file read-only. It
does not mount the host root, home directory, Docker socket, or unrelated
repositories and secrets. The container receives normal command network access
and a writable ephemeral filesystem, so package managers and developer tools
work without a second filesystem sandbox fighting them. Its process runs as the
host user's numeric ID with Linux capabilities removed, which preserves
workspace file ownership.

Inside that externally isolated environment Relay starts `codex exec` with
`danger-full-access`, as recommended by the
[official Codex documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
for a controlled container. This is full access to the disposable container,
never full access to the host. The only durable writable host path remains the
configured workspace. Web search and user configuration are disabled, and
approvals are never interactive. Relay and API credentials are removed from the
container runtime environment. The explicitly configured GitHub token is the
only task credential forwarded beyond the read-only Codex login.

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

Software tasks can edit repositories and use GitHub from the mounted workspace
today. Structured `branch`, `commit`, `pull_request`, and `check` artifacts
remain future work; current tasks return those details in Markdown.
