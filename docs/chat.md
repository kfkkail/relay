# Conversational Relay experiment

Open **Chat** to ask general questions, prepare for the week, or request a check of connected sources without writing a task brief or choosing a deliverable. Conversations and replies live in Relay's Supabase project. Each message uses the existing local worker queue and selected Codex or OpenAI backend; it does not require another hosted chat product. Model providers still receive the context needed to answer: this is not fully local model inference.

## Behavior

- Saved conversations, plain Markdown replies, follow-up history, and explicit queued/working/failed states. An offline worker leaves messages queued.
- Use **+** beside the message box to attach one JPEG, PNG, or WebP up to 10 MB. Preview or remove it before sending. An image sent without a message asks Relay to describe it. The image stays visible in the thread, and Relay sends its pixels to the worker for the attached turn. Follow-up turns receive the prior text and replies.
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

### Chat image uploads

Apply the chat images migration before deploying the updated app. Relay stages
uploads in the existing private task attachment bucket and removes the staging
copy after processing the send. An upload interrupted before the app submits
the message can leave a staging object in that bucket.

### Worker wake-ups

After deploying the chat worker wake-up migration, set `SUPABASE_JWT_SECRET`
in the web app's server environment to the project's active Supabase legacy JWT
secret (HS256). This is the JWT signing secret, separate from the Supabase
API keys. Only the web app needs it. Keep it server-side and redeploy the app
after setting it. The project must accept HS256 tokens for Realtime.

An upgraded worker uses its Relay token to obtain a short-lived credential for
its owner's private Realtime channel. Chat queue inserts broadcast an empty
signal after commit. On receipt or successful subscription/reconnection, a
worker checks the existing claim endpoint. No worker needs an inbound port.
The existing idle polling backoff covers missed signals, unavailable Realtime,
and deployments without the signing secret. Running jobs still occupy their
worker slots until they finish.
