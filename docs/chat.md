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

The conversational completion contract permits observation and advice and prohibits external writes, even when requested in chat. **This is an agent instruction, not a technical read-only credential boundary:** the existing Codex runtime retains its installed tools and account capabilities. Use explicitly scoped read-only connector credentials before treating this as a security boundary. Actions should be requested through ordinary tasks.

Apply the migration before deploying the application, then update the worker. The new chat-aware claim RPC defaults to excluding chat; the legacy RPC keeps its signature and excludes chat too. Only updated workers advertise chat support, so old workers continue ordinary tasks and leave conversations queued instead of running the wrong completion policy. The migration adds the chat-aware RPC and updates the legacy claim filter without changing its signature.

## Scope and next steps

This is on-demand conversational groundwork, not an always-running autonomous monitor. Existing schedules remain the way to request recurring checks. A future opt-in monitoring layer should persist interests, tie scheduled observations to conversations, deduplicate opportunities, enforce notification budgets and quiet hours, and use connector-level read-only capabilities. There is no streaming, conversation search, or automatic long-term memory in this version.

Validation includes API tests for authentication, input limits, query relationship selection and active-turn conflicts, plus pgTAP coverage for persistence, ownership, idempotency and history. The SQL suite should run on a fresh local Supabase database before deployment.
