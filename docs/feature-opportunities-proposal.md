# Relay feature opportunities proposal

> Status: product discovery proposal  
> Scope: candidate improvements beyond the current task-to-worker review loop

## Purpose

Relay already covers the core loop: describe work on a phone, let a local worker
execute it, review the result, provide feedback, and accept or create follow-up
work. The next features should make that loop easier to trust and reuse without
turning Relay into a chat client or a general-purpose project manager.

This proposal presents a menu of product opportunities rather than a committed
roadmap. Each item can ship independently after validating the underlying user
need. Existing proposals already cover notifications, task image attachments,
the expanded My Work experience, and task result documents, so those are treated
as existing or parallel work and are not repeated here.

## Product principles

- Keep the task, its runs, and its outcome as the durable record.
- Preserve the mobile-first capture and review experience.
- Keep workers outbound-only and make offline behavior obvious.
- Ask for confirmation before actions with external or destructive effects.
- Add structure where it improves reliability, not merely to expose agent
  internals.
- Prefer small capabilities that compose over a configurable workflow builder.

## Recommended priorities

| Priority | Opportunity | Why now | Relative effort |
| --- | --- | --- | --- |
| 1 | Run readiness and estimates | Prevents tasks from appearing stuck and makes worker capacity understandable | Small |
| 2 | Reusable task templates | Reduces repeated typing and improves task quality | Small–medium |
| 3 | Structured results and external-change receipts | Makes agent work faster to verify and safer to accept | Medium |
| 4 | Task scheduling and recurring tasks | Extends Relay from reactive capture to lightweight automation | Medium |
| 5 | Workspace and worker routing | Supports multiple repositories or machines without manual reconfiguration | Medium |
| 6 | Search, filters, and saved views | Keeps the task archive useful as history grows | Medium |
| 7 | Approval checkpoints | Enables longer, riskier work while keeping the owner in control | Large |
| 8 | Task dependencies and lightweight batches | Coordinates related work without becoming a full project manager | Large |

## Feature proposals

### 1. Run readiness and estimates

Show why a run is waiting and what will happen next. A queued task should display
the selected worker, its last-seen time, the number of jobs ahead of it, and a
plain-language state such as `Waiting for MacBook`, `Worker offline`, or
`Starting`. Once running, show elapsed time and the latest safe progress summary.

The first version should derive readiness from existing worker heartbeats and
run state. It should avoid precise completion-time promises until Relay has
enough historical data to make them meaningful.

**Success signal:** fewer abandoned or duplicate runs caused by uncertainty
about worker status.

### 2. Reusable task templates

Let owners save a strong task as a reusable template. A template can provide a
title pattern, Markdown instructions, default worker or workspace, and optional
input prompts such as repository, branch, or target URL. Creating from a
template produces a normal editable task; later template edits do not rewrite
past tasks.

Start with personal templates and a small set of examples such as bug diagnosis,
dependency update, pull-request review, and release preparation. Sharing and a
template marketplace should remain out of scope until personal reuse is proven.

**Success signal:** increased template reuse and fewer feedback cycles per run.

### 3. Structured results and external-change receipts

Add an optional structured summary alongside the Markdown result:

- outcome and concise summary;
- files changed and validation performed;
- warnings, blockers, and owner decisions needed;
- external actions taken, including commit, branch, or pull-request URLs;
- suggested follow-up tasks.

The worker should submit this metadata explicitly rather than Relay attempting
to infer it from prose. The task detail view can render a compact receipt while
preserving the full Markdown result. Acceptance should mean “I reviewed this
result,” not automatically merge, deploy, or perform another external action.

**Success signal:** shorter review time and fewer questions about what changed.

### 4. Task scheduling and recurring tasks

Allow a task to be queued at a future time and optionally repeated from a saved
task definition. Useful examples include weekly dependency checks, monthly
report generation, and a morning repository health scan.

An MVP should support one-time scheduling plus simple daily, weekly, or monthly
recurrence in the owner's timezone. Each occurrence must create its own task or
run record so its instructions and result remain auditable. Missed schedules
should queue once when service resumes rather than creating a burst of backfill
runs.

Recurring work needs clear pause, resume, next-run, and failure indicators. It
should not launch if its chosen worker or workspace no longer exists.

**Success signal:** scheduled tasks complete reliably without duplicate runs or
manual recreation.

### 5. Workspace and worker routing

Support named workspace profiles so one owner can safely route work to different
repositories or machines. A profile would pair a display name with a worker and
a worker-local workspace identifier; the cloud application should never store
an unrestricted local path.

Workers advertise only configured profiles and capabilities, such as Codex CLI,
API-only execution, or GitHub CLI availability. Task creation selects an
eligible profile, with a clear default and an error when none is online. Worker
tokens remain independently revocable.

**Success signal:** successful use across multiple projects without tasks being
run in the wrong workspace.

### 6. Search, filters, and saved views

Add full-text task search across title, instructions, results, and feedback,
with filters for lifecycle state, date, worker, workspace, and whether owner
input is required. Common filter combinations can be saved as private views.

Begin with server-side search and URL-addressable filters. Avoid tags initially;
usage of search and saved views will reveal whether a separate taxonomy is
actually needed.

**Success signal:** owners can retrieve an older result quickly as task volume
grows.

### 7. Approval checkpoints

Allow a worker to pause a run with a structured approval request before a
high-impact step. The request should state the proposed action, why it is
needed, the affected target, and available choices. The owner can approve,
reject, or provide revised instructions; every response is appended to the
event history.

This is not general chat. A checkpoint is a typed run state with one pending
decision. Approval must be narrowly scoped and expire when the run ends. Relay
must never interpret approval for one action as permission for later actions.

An MVP should first support worker-authored checkpoints for local execution.
Automatically classifying risky commands can be explored later and should not
replace the worker sandbox or existing platform confirmations.

**Success signal:** more complex tasks finish in one run without weakening
control over external changes.

### 8. Task dependencies and lightweight batches

Let a task depend on one or more other tasks. A dependent task remains blocked
until its prerequisites are accepted, and can optionally receive their
structured summaries as context. A batch view shows progress and failures for a
small related set.

Keep the model deliberately limited: an acyclic dependency graph, explicit
owner-created links, no conditional branches, and no visual workflow editor.
Cancellation and failed prerequisites must leave downstream tasks blocked for
owner review rather than silently skipping or running them.

**Success signal:** related multi-step work needs less manual coordination while
remaining understandable on mobile.

## Suggested delivery sequence

### Phase 1 — clarity and reuse

Ship run readiness, then task templates. Both improve the current loop with
limited schema and execution risk. Instrument worker-offline time, queue delay,
template reuse, and feedback retries before moving on.

### Phase 2 — trustworthy outcomes

Introduce a versioned structured-result payload and render result receipts.
Then add search and filters so both existing Markdown and new structured fields
remain discoverable.

### Phase 3 — controlled automation

Add named workspace routing before scheduled tasks, ensuring unattended work
has an explicit destination. Roll out one-time schedules before recurrence and
include idempotency keys for every scheduled occurrence.

### Phase 4 — multi-step work

Prototype approval checkpoints with a small number of request types. Consider
dependencies only after structured results and routing are stable, because
downstream tasks need both reliable context and deterministic execution targets.

## Cross-cutting requirements

- Every new table and API must preserve per-owner isolation and row-level
  security.
- Mutating worker APIs must be idempotent and safe to retry after network loss.
- Task and run history should record scheduling, routing, approvals, and external
  effects in a human-readable audit trail.
- New controls must work on narrow mobile screens and with keyboard and screen
  reader navigation.
- Worker and web changes that depend on one another need a versioned,
  backward-compatible rollout.
- Sensitive local details, credentials, raw environment values, and unrestricted
  filesystem paths must never be copied into cloud records or result metadata.

## Decisions to validate before implementation

1. Are owners primarily repeating the same instructions, coordinating multiple
   repositories, or waiting on long-running work? This determines whether
   templates, routing, or checkpoints should lead after readiness improvements.
2. Should a recurring occurrence create a new task or a new run on one standing
   task? New tasks provide clearer audit history and are the recommended default.
3. Which structured result fields can every backend produce reliably without
   inventing data?
4. What external actions should always require a checkpoint even when a task's
   original instructions mention them?
5. How long should offline workers remain selectable, and when should scheduled
   work be marked as needing owner attention?

## Explicit non-goals

This proposal does not recommend team collaboration, public template sharing,
arbitrary workflow programming, autonomous merging or deployment, a chat-first
interface, or replacing the worker sandbox. Those additions would change
Relay's trust and ownership model and should be evaluated as separate product
directions.
