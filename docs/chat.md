# Conversational Relay experiment

Open **Chat** to ask general questions, prepare for the week, or request a check of connected sources without writing a task brief or choosing a deliverable. Conversations and replies live in Relay's Supabase project. Each message uses the existing local worker queue and selected Codex or OpenAI backend; it does not require another hosted chat product. Model providers still receive the context needed to answer: this is not fully local model inference.

## Behavior

- Saved conversations, plain Markdown replies, follow-up history, and explicit queued/working/failed states. An offline worker leaves messages queued.
- One active reply per conversation. Database locking serializes submissions; stable message IDs prevent duplicate work when a network response is lost. Failed turns allow another message.
- Each reply receives the latest 12 turns (each prior reply limited to 4,000 characters), 10 recent ordinary tasks with accepted-result excerpts, and 20 open owner actions. History and database snapshots are capped at 60,000 and 16,000 characters respectively; capped JSON may be incomplete and is labeled as truncated context. This is bounded read access, not arbitrary database querying or permanent model memory.
- The UI lists the latest 100 conversations and 100 turns. Internal chat task rows stay out of task navigation. Existing task result notifications redirect to the conversation.
- Codex may read HEY, calendar and other connections already available to its worker environment. No new credentials are collected and no connector is promised before a successful read. The direct OpenAI backend has no connector tools and answers only from supplied context.

## Permissions and deployment

Conversation and turn data use owner RLS. A composite foreign key prevents linking a task to another owner's conversation. The message RPC runs as the authenticated caller and builds its context from that owner's rows. The worker receives text snapshots, not database credentials.

Chat uses the same worker permissions and capabilities as tasks. The owner can request project edits, validation, generated documents, and external actions directly in a conversation without creating a separate task. The shared worker policy still requires explicit requests for external changes, preserves the workspace sandbox, and protects credentials. Questions and advice do not authorize unrelated actions, and retrieved context or prior assistant suggestions cannot grant authorization. The direct OpenAI backend still has no tools and must report that limitation.

Generated documents use the existing private task/run upload and owner-authenticated download routes. Chat renders the same document list and inline filename links as tasks, including direct calendar downloads. Updating the worker is required to replace the previous observation-only chat contract.

Apply the migration before deploying the application, then update the worker. The new chat-aware claim RPC defaults to excluding chat; the legacy RPC keeps its signature and excludes chat too. Only updated workers advertise chat support, so old workers continue ordinary tasks and leave conversations queued instead of running the wrong completion policy. The migration adds the chat-aware RPC and updates the legacy claim filter without changing its signature.

## Scope and next steps

This is on-demand conversational groundwork, not an always-running autonomous monitor. Existing schedules remain the way to request recurring checks. A future opt-in monitoring layer should persist interests, tie scheduled observations to conversations, deduplicate opportunities, enforce notification budgets and quiet hours, and use connector-level read-only capabilities. There is no streaming, conversation search, or automatic long-term memory in this version.

Validation includes API tests for authentication, input limits, query relationship selection and active-turn conflicts, plus pgTAP coverage for persistence, ownership, idempotency and history. The SQL suite should run on a fresh local Supabase database before deployment.

## Response latency

There are three separate waits: queue pickup, generation/tools, and displaying
completion. The worker now checks for work every five seconds by default even
while idle (previously it backed off to sixty seconds), and claims queued work
before checking for updates. Chat refreshes every second while a turn is queued
or working, returning to five seconds afterward. With an available worker slot,
these default polling delays total up to roughly six seconds instead of sixty-five,
excluding network requests, maintenance, and generation time. This is a bound on
configured polling sleeps, not a measured end-to-end latency guarantee.

Existing workers with an explicit sixty-second idle cap need their configuration
updated as described in `worker/README.md`. Shorter polling increases idle claim
traffic to twelve requests per minute; pending chat refresh traffic rises to sixty
requests per minute per open tab. No model or tool permissions change.

Further improvements, in order to investigate:

- Measure queue age at claim, model startup/first output, tool execution, and result
  delivery separately before choosing the next optimization. Do not log prompts
  or private replies.
- Add authenticated queue wakeups and completion notifications to reduce polling
  delay without continually increasing request volume.
- Stream partial replies so users see progress during generation. The current
  worker buffers a complete structured result; this needs a separate progress
  protocol that does not expose raw tool diagnostics or partial document JSON.
- Reuse isolated conversation sessions to avoid launching a fresh CLI process and
  replaying history each turn, with explicit ownership and expiry boundaries.
- Evaluate a chat-specific model/reasoning setting and smaller context snapshots
  against representative questions and action requests before trading quality for
  speed. Chat can perform real work, so it still needs tools and authorization.
- Consider reserved chat capacity if all five worker slots are often occupied;
  shorter polling cannot help a saturated worker.

Maintenance still blocks new claims while it runs. Moving installs to a separate
staging location and switching versions only between runs would address that
remaining delay safely.
