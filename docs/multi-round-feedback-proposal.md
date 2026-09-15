# Multi-round feedback continuity proposal

## Recommendation

Treat each feedback run as a revision of the latest successful result, not as a fresh attempt from the original task. Send the worker a bounded revision context containing:

1. the current task title and instructions;
2. the feedback ledger from prior feedback rounds, in attempt order;
3. the latest completed result as the revision baseline; and
4. the new feedback as the change request for this run.

Do not resend every prior result. The latest completed result is the artifact being revised, while the feedback ledger preserves requirements that may not be obvious from that artifact. This hybrid retains intent without making prompt size grow by one full result on every round.

The first run remains unchanged. A retry after a technical failure should also remain a retry of the same run input; it should not invent a new feedback round.

## Why this is needed

Relay already persists every run's `feedback` and `result_markdown`, but the claimed worker payload contains only the original task and the current run's feedback. The worker constructs a new prompt from those fields and labels the feedback as being about “the previous attempt,” without including that attempt. Consequently, phrases such as “keep the structure, shorten the second section” or “undo the last change” have no reliable referent.

The review screen reinforces a continuous revision mental model: it shows the latest result, asks for “Feedback for another run,” and offers **Run again**. The execution model should match that user expectation.

## User experience

Keep the primary interaction lightweight:

- Rename **Run again** to **Revise result** when a completed result exists. “Run again” suggests regeneration; “Revise result” states that the visible output is the baseline.
- Change the field label to **What should change?** and the placeholder to an example such as “Keep the format, but shorten the recommendation and add rollout risks.”
- After submission, show that the next attempt is “Revising attempt N” rather than silently replacing the visible result.
- Preserve the latest completed result on screen while the revision is queued or working. This makes the target of feedback explicit and avoids a blank review state.
- Add a collapsed **Revision history** section listing attempts, feedback, status, and timestamp. Expanding an attempt shows its result. The latest attempt remains the default view.
- Allow accepting any completed attempt from history in a later enhancement. For the initial continuity fix, acceptance may continue to apply to the latest completed attempt.

No mode selector is recommended. Asking users to choose between “use previous output” and “start over” on every round adds ambiguity. A distinct **Start fresh** action can be considered later if observed usage shows a need; it should create a clearly labeled new attempt without a revision baseline.

## Technical design

### Context contract

Extend the worker claim response with a versioned `revisionContext` object:

```json
{
  "version": 1,
  "baseRun": {
    "id": "uuid",
    "attempt": 2,
    "resultMarkdown": "..."
  },
  "feedbackHistory": [
    { "attempt": 2, "feedback": "..." },
    { "attempt": 3, "feedback": "..." }
  ]
}
```

For a feedback run, `baseRun` is the highest-attempt completed run before the claimed run. `feedbackHistory` contains non-null feedback from completed prior runs and the current run, ordered by attempt. Failed or cancelled attempts should not become the base, but their user-authored feedback should remain in the ledger if it still led to the current request. The current feedback should also remain on `run.feedback` during the transition for compatibility.

Build the worker input in this order:

```text
# Task
...

# Instructions and context
...

# Revision requirements from earlier rounds
- Attempt 2: ...

# Result to revise (attempt 2)
...

# Requested changes for this revision
...
```

Add a trusted worker instruction: revise the supplied baseline in place, preserve unaffected content and previously stated requirements, and return the complete updated result rather than a patch, critique, or description of changes.

### Data and query behavior

No new persistence is required for the first release: `runs` already stores attempt order, feedback, result text, status, and timestamps. Update `claim_next_run` in a new migration to return the base completed run and ordered feedback history for the selected task. Constructing this in the atomic claim function prevents an extra worker round trip and guarantees the context is selected relative to the claimed attempt.

If typed nested JSON from the database function proves awkward, return `base_run_id`, `base_attempt`, `base_result_markdown`, and `feedback_history jsonb` as flat columns and shape them in the claim route.

Add a conservative context budget before invoking either backend:

- Always retain the original task, current feedback, and latest result.
- Retain feedback entries in full because they are user requirements and are already limited to 20,000 characters each.
- If the assembled input exceeds the configured budget, drop oldest superseded feedback entries only after recording a deterministic truncation marker. Do not ask the model to summarize requirements during the worker run; lossy model-generated summaries can silently change them.
- Initially enforce a product limit such as 100,000 characters for revision context and return an actionable run failure if the mandatory task, latest result, and current feedback alone exceed it. Make the limit configurable because model context windows differ.

The existing 200,000-character result limit can exceed some model configurations once task text and feedback are added. The worker should validate the assembled context before starting the model call and report “Revision context is too large; shorten the task or start a fresh task” rather than failing opaquely.

### Concurrency and lineage

The existing one-active-run-per-task constraint is sufficient. At feedback submission time, additionally require a completed result and store its ID as `base_run_id` on the new run. Although the base can be derived today, explicit lineage makes behavior stable if the product later supports accepting older attempts, branching revisions, or concurrent variants.

Adding nullable `runs.base_run_id references runs(id) on delete restrict` is therefore recommended despite the context being queryable without it. Validate in the feedback route that the base belongs to the same task and predates the new attempt. Initial runs and true fresh starts have a null base.

### API and compatibility

- Add fields without removing the existing claim fields so old workers can still claim runs during rollout.
- Advertise worker capability/version in the claim request or worker record. Until all workers support revision context, the server should either block feedback runs with an upgrade message or continue legacy behavior with an explicit warning in the UI; silently degrading would preserve the bug.
- Keep result completion and acceptance APIs unchanged.
- Escape or structurally delimit all task, feedback, and result content as untrusted input. Prior agent output is also untrusted and must not be promoted into trusted worker instructions.

## Tradeoffs

### Recommended hybrid versus full transcript

The hybrid sends one result plus the feedback ledger. It has bounded growth relative to resending all outputs and gives “change this” a concrete target. A full transcript is easier to reason about conceptually, but duplicates large results, raises cost and latency each round, and increases the chance that obsolete drafts distract the model.

### Hybrid versus latest result only

Sending only the latest result is cheapest and often works, but requirements can disappear from the prose itself. For example, a user may have said “never mention vendor names”; a compliant latest result does not encode that rule. Keeping prior feedback protects such negative and process constraints.

### Explicit lineage versus derivation

Deriving the base from attempt order avoids a migration, but becomes ambiguous as soon as users can revisit or branch an older result. An explicit `base_run_id` adds a small schema and validation cost in exchange for durable, auditable semantics.

## Rollout

1. Add `base_run_id`, database constraints/indexing, and the expanded claim function. Backfill existing feedback runs by linking each to the nearest preceding completed run for the same task; leave null when none exists.
2. Update worker prompt assembly and add unit tests for first runs, second and later revisions, failures between revisions, context limits, and untrusted delimiter-like text.
3. Deploy worker capability reporting and require a compatible worker for new feedback submissions.
4. Update the review copy and add the collapsed history UI.
5. Instrument revision count, completion/failure rate by attempt, context size, latency, and acceptance after revision. Do not log feedback or result bodies.
6. After a short observation period, decide whether accepting older attempts or an explicit fresh-start action is warranted.

For existing queued feedback runs created before deployment, either populate `base_run_id` during migration or leave them queued until a compatible worker is online. They should not execute with legacy context once the UI promises revision behavior.

## Acceptance criteria

- A second attempt receives the original task, attempt 1's complete result, and the new feedback.
- A third or later attempt receives only the latest completed result, plus all applicable feedback requirements in attempt order; it does not receive every historical result.
- The worker is instructed to return a complete revised result and to preserve unaffected content.
- Failed and cancelled results are never selected as revision baselines.
- A failure between completed attempts does not erase the last valid baseline or user-authored feedback.
- Each feedback run records an immutable `base_run_id` belonging to the same task.
- First runs remain behaviorally unchanged.
- Oversized revision context fails before a model call with a user-actionable message.
- Older workers cannot silently process a revision without its context.
- The review UI makes clear which attempt is being revised and exposes prior attempts in a collapsed history.
- Automated tests cover database lineage selection, API response shaping, prompt ordering, context truncation/failure, and both OpenAI and Codex backends.
- Telemetry records counts and sizes only, never task, feedback, or result contents.

## Out of scope

Semantic summarization of long histories, branching multiple variants, merging feedback from multiple users, inline annotations, diff rendering, and autonomous selection of an older baseline should be separate follow-ups. The first release should make the existing linear feedback flow reliable and understandable.
