# Recurring tasks

Open Settings → Schedules. Create a schedule with ordinary task instructions and
one of Relay's existing deliverables. Choose every 30 minutes, hourly, or daily,
selected weekdays, a timezone, and a daytime window. Preview the next three due
times before saving. New forms default to paused; enable execution explicitly.

Supabase Cron calls `dispatch_task_schedules()` every minute, directly inside
Postgres. No new Vercel endpoint, Vault secret, or Pi timer is required. Each
occurrence atomically creates a task and its initial run. Existing workers claim
these normally. The migration installs the dispatcher but creates no schedules.

Slots use local wall-clock time and intervals anchor to the window start. The
window end is exclusive. Spring-forward times that do not exist are skipped;
repeated autumn times run once using PostgreSQL's standard-time interpretation.
Run now works outside the window and does not move the recurring due time.

One queued or working run is permitted across all occurrences of a schedule,
including feedback reruns. Missed slots coalesce into one catch-up occurrence.
Catch-ups wait for an allowed day/window; daily catch-ups wait until the daily
time. Due times are not execution guarantees. The Pi must be connected and have
capacity. A stuck working run blocks the schedule and appears in its history;
this release does not automatically retry uncertain executions that may have
made external changes. Ordinary task feedback and review remain available.

Pause, edit, and archive cancel unclaimed runs. A running task retains its own
instructions and finishes normally. Resume recalculates the next future slot.
Archive preserves results. Recent history shows up to 100 occurrences across
schedules; generated tasks remain in the ordinary task list as well.

This feature uses the worker's existing permissions. It does not provide a
restricted HEY adapter, incremental mailbox checkpoints, deduplication, calendar
synchronization, or unattended recovery of external mutations. Specify bounded
instructions and select a suitable deliverable for each recurring task.

Migrations deploy through the normal repository workflow. To roll back execution,
pause schedules before reverting the UI. Keep the additive database schema.
