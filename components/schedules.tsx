"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { deliverables, type Deliverable } from "@/lib/deliverables";

type Schedule = {
  id?: string;
  title: string;
  instructions: string;
  deliverable: Deliverable;
  timezone: string;
  weekdays: number[];
  interval_minutes: number;
  start_minute: number;
  end_minute: number;
  enabled: boolean;
  archived: boolean;
  next_due_at?: string;
};
type Occurrence = {
  id: string;
  schedule_id: string;
  task_id: string | null;
  due_at: string;
  trigger: string;
  tasks: { runs: { status: string }[] } | null;
};
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fresh = (): Schedule => ({
  title: "",
  instructions: "",
  deliverable: "investigation",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekdays: [1, 2, 3, 4, 5],
  interval_minutes: 60,
  start_minute: 540,
  end_minute: 1080,
  enabled: false,
  archived: false,
});
const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
const date = (value: string, zone: string) =>
  new Date(value).toLocaleString(undefined, { timeZone: zone });

export function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [previewFor, setPreviewFor] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/schedules");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSchedules(body.schedules);
      setOccurrences(body.occurrences);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load schedules.");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  async function submit(body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if ("slots" in result) {
        setPreview(result.slots);
        setPreviewFor(JSON.stringify(draft));
      } else {
        setDraft(null);
        setPreview([]);
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save schedule.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="app-shell schedules-page">
      <header className="schedule-header">
        <Link href="/my-work" className="brand-lockup">
          <span className="brand-mark">R</span>Relay
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/my-work">My Work</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/schedules" aria-current="page">
            Schedules
          </Link>
        </nav>
      </header>
      <section className="schedule-content">
        <div className="schedule-heading">
          <h1>Schedules</h1>
          <button className="primary-button" onClick={() => setDraft(fresh())}>
            New schedule
          </button>
        </div>
        <p>
          Recurring tasks run on your connected worker. Due times are queue
          times; execution can start later. Missed slots combine into one
          catch-up run.
        </p>
        {error && <p role="alert">{error}</p>}
        {draft && (
          <form
            className="schedule-card schedule-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit({ id: draft.id, config: draft });
            }}
          >
            <h2>{draft.id ? "Edit schedule" : "New schedule"}</h2>
            <label>
              Title
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Instructions
              <textarea
                required
                rows={6}
                maxLength={100000}
                value={draft.instructions}
                onChange={(e) =>
                  setDraft({ ...draft, instructions: e.target.value })
                }
              />
            </label>
            <label>
              Deliverable
              <select
                value={draft.deliverable}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    deliverable: e.target.value as Deliverable,
                  })
                }
              >
                {Object.entries(deliverables).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Frequency
              <select
                value={draft.interval_minutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    interval_minutes: Number(e.target.value),
                  })
                }
              >
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every hour</option>
                <option value={1440}>Once daily</option>
              </select>
            </label>
            <div className="schedule-times">
              <label>
                {draft.interval_minutes === 1440 ? "At" : "From"}
                <input
                  type="time"
                  required
                  value={time(draft.start_minute)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      start_minute: minutes(e.target.value),
                      end_minute: Math.max(
                        draft.end_minute,
                        minutes(e.target.value) + 1,
                      ),
                    })
                  }
                />
              </label>
              {draft.interval_minutes !== 1440 && (
                <label>
                  Until (exclusive)
                  <input
                    type="time"
                    required
                    value={time(draft.end_minute)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        end_minute: minutes(e.target.value),
                      })
                    }
                  />
                </label>
              )}
            </div>
            <label>
              Timezone
              <input
                required
                value={draft.timezone}
                onChange={(e) =>
                  setDraft({ ...draft, timezone: e.target.value })
                }
              />
            </label>
            <fieldset>
              <legend>Days</legend>
              <div className="schedule-days">
                {days.map((day, index) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={draft.weekdays.includes(index)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          weekdays: e.target.checked
                            ? [...draft.weekdays, index]
                            : draft.weekdays.filter((d) => d !== index),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="schedule-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Enable recurring execution
            </label>
            <p>
              Runs use your worker’s existing tools and permissions. Saving
              edits cancels queued occurrences; an active run keeps its original
              instructions. No email deduplication or synchronization is
              included.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit({ action: "preview", config: draft })}
            >
              Preview next three runs
            </button>
            {preview.length > 0 && previewFor === JSON.stringify(draft) && (
              <ul>
                {preview.map((slot) => (
                  <li key={slot}>{date(slot, draft.timezone)}</li>
                ))}
              </ul>
            )}
            <div className="schedule-actions">
              <button
                disabled={
                  busy ||
                  !draft.weekdays.length ||
                  draft.end_minute <= draft.start_minute
                }
                className="primary-button"
              >
                {busy ? "Saving…" : "Save schedule"}
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {!loaded && !error && <p>Loading schedules…</p>}
        {loaded && !schedules.length && (
          <p>No schedules yet. Create one to queue tasks automatically.</p>
        )}
        {schedules.map((s) => (
          <article className="schedule-card" key={s.id}>
            <h2>{s.title}</h2>
            <p>
              {s.archived ? "Archived" : s.enabled ? "Enabled" : "Paused"} ·{" "}
              {s.interval_minutes === 1440
                ? `Daily at ${time(s.start_minute)}`
                : `Every ${s.interval_minutes} minutes · ${time(s.start_minute)}–${time(s.end_minute)}`}{" "}
              · {s.weekdays.map((d) => days[d]).join(", ")} · {s.timezone}
            </p>
            {s.enabled && !s.archived && s.next_due_at && (
              <p>
                Next due: {date(s.next_due_at, s.timezone)}
                {new Date(s.next_due_at) < new Date()
                  ? " · Overdue / waiting for the next available slot"
                  : ""}
              </p>
            )}
            {!s.archived && (
              <div className="schedule-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void submit({
                      action: "run",
                      id: s.id,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  Run now
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void submit({
                      id: s.id,
                      config: { ...s, enabled: !s.enabled },
                    })
                  }
                >
                  {s.enabled ? "Pause" : "Resume"}
                </button>
                <button disabled={busy} onClick={() => setDraft({ ...s })}>
                  Edit
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void submit({
                      id: s.id,
                      config: { ...s, enabled: false, archived: true },
                    })
                  }
                >
                  Archive
                </button>
              </div>
            )}
            <details>
              <summary>Recent occurrences</summary>
              <ul>
                {occurrences
                  .filter((o) => o.schedule_id === s.id)
                  .map((o) => (
                    <li key={o.id}>
                      {o.task_id ? (
                        <Link href={`/tasks/${o.task_id}`}>
                          {date(o.due_at, s.timezone)}
                        </Link>
                      ) : (
                        date(o.due_at, s.timezone)
                      )}{" "}
                      · {o.trigger} ·{" "}
                      {o.tasks?.runs.map((r) => r.status).join(", ") ||
                        "Task removed"}
                    </li>
                  ))}
              </ul>
            </details>
          </article>
        ))}
      </section>
    </main>
  );
}
