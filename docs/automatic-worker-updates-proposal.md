# Automatic worker updates — simple v1 proposal

## Decision

For v1, install the worker from a dedicated local clone and let that installation
poll `origin/main` for updates. When the worker is idle and `main` has advanced,
it fast-forwards the clone, installs locked dependencies, and exits. The existing
launchd/systemd service immediately starts the updated worker.

This makes an online worker follow successful merges to `main` without requiring
an artifact service, release manifest, supervisor, database migration, new API,
or inbound access to the owner's machine.

Treat merge to `main` as the worker deploy event in v1. Vercel cannot directly
restart a laptop or Raspberry Pi because workers are outbound-only. If production
promotion later becomes separate from merging, the update source can be changed
to a small production-version endpoint.

## Scope

V1 includes:

- a dedicated, installer-managed clone used only to run Relay's worker;
- periodic checks for a newer `origin/main` commit;
- updates only between tasks;
- `git` fast-forward, `npm ci`, and a service-managed restart;
- bounded logs and retry on the next check after a failure;
- a configuration flag to disable automatic updates.

V1 does not include:

- packaged releases, signed manifests, or an artifact registry;
- a separate supervisor or automatic rollback;
- worker-version reporting in the Relay UI;
- updates to Node.js, Codex CLI, Git, or the operating system;
- updates from feature branches or preview deployments.

## Design

### 1. Separate installation from task workspaces

Extend `npm run worker:service:install` to create an installation-owned clone,
for example `~/.local/share/relay-worker/app` on Linux and
`~/Library/Application Support/Relay Worker/app` on macOS. The service runs
`worker/index.mjs` from this clone rather than from the checkout where setup was
invoked.

Copy `.env.worker` to the installation directory with owner-only permissions.
Do not put the installation clone inside `RELAY_CODEX_WORKSPACE` and do not allow
tasks to use it as a project checkout. This separation is the important safety
boundary: updating the worker must never pull, clean, or switch branches in an
owner's working repository.

The first implementation may clone the configured `origin` URL. The installer
should fail clearly if it cannot authenticate to that repository. No new GitHub
token is needed when the owner's existing Git credential helper or `gh` setup can
clone it.

### 2. Check for updates while idle

Add a small update check to the worker's existing polling loop. Every five
minutes, and only when no run is active:

1. Run `git fetch --quiet origin main` with a timeout.
2. Compare `HEAD` with `origin/main`.
3. If they match, continue polling for work.
4. If local `HEAD` is an ancestor of `origin/main`, start the update.
5. If the clone is dirty or cannot fast-forward, log a bounded error and keep the
   current worker running.

Add jitter later only if Relay operates enough workers for synchronized fetches
to matter.

### 3. Update and restart

The update sequence is intentionally short:

1. Stop claiming new work.
2. Run `git merge --ff-only origin/main`.
3. Run `npm ci --omit=dev --ignore-scripts` only when `package-lock.json` changed.
4. Run a lightweight startup/configuration check that does not claim a task.
5. Exit with code 0.
6. Let launchd/systemd restart the worker using its existing `KeepAlive` or
   `Restart=always` policy.

If fetch fails, the branch cannot fast-forward, dependency installation fails,
or validation fails, log only a short error and continue running the previous
in-memory worker. Retry on the next scheduled check. The on-disk clone may be
partially updated after an `npm ci` or validation failure, so the service should
not intentionally restart in that state; operator recovery is `git reset` to a
known commit followed by reinstall. Automatic rollback is deferred from v1.

Set `RELAY_WORKER_AUTO_UPDATE=off` to disable checks. Automatic updates should be
enabled by default for new dedicated-clone installations and disabled for the
legacy run-from-checkout layout.

## Deployment ordering

Worker and server changes still need backward-compatible rollouts. A merge can
reach Vercel and local workers at different times, and an offline worker may
remain old indefinitely. Therefore:

- deploy additive server/database changes before worker code that requires them;
- keep the server compatible with the prior worker version;
- do not make a web deployment depend on every worker updating;
- use a manual worker update for an emergency fix that cannot wait five minutes.

## Failure behavior

| Condition | V1 behavior |
| --- | --- |
| Machine is offline | No update; it checks after reconnecting |
| Task is running | Update waits until the task finishes |
| GitHub is unavailable | Current worker keeps running and retries later |
| Installation clone is dirty/diverged | Update is refused and logged |
| `npm ci` or validation fails | Do not restart; report recovery instructions |
| New worker crashes after restart | launchd/systemd retries; owner must roll back manually |

The last two cases are accepted v1 limitations. They are why the change should
first run on one worker for several deploys before broad adoption.

## Implementation plan

1. Add an installation-directory helper and migrate service installation to a
   dedicated clone while preserving `.env.worker` permissions.
2. Add an `update-check.mjs` module with command timeouts and tests for clean,
   current, fast-forwardable, dirty, diverged, and fetch-failure states.
3. Call the checker from the idle polling loop and exit after a validated update.
4. Add `npm run worker:service:update` for an immediate manual check and document
   disable and recovery procedures.
5. Canary on one macOS worker and one Linux/Raspberry Pi worker.

## Acceptance criteria

1. Within ten minutes of a merge to `main`, an online idle worker runs that
   commit without owner action.
2. A worker never interrupts a claimed task to update.
3. Updating never changes the owner's source checkout, task workspaces, or
   credentials.
4. Only a clean fast-forward from the configured `origin/main` is applied.
5. A fetch or pre-restart validation failure leaves the current in-memory worker
   available and produces a bounded diagnostic.
6. Auto-update can be disabled, and an owner can trigger the same update check
   manually.

## Follow-up, only if v1 proves insufficient

Add immutable release archives, integrity manifests, production-deployment
gating, version status in the UI, and automatic rollback. Those features improve
fleet safety, but they are not required to remove today's routine manual update.
