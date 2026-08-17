"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Laptop,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { buildFollowUpInstructions, latestCompletedRun, statusLabel } from "@/lib/domain";
import type { Task, TaskStatus, Worker } from "@/lib/types";

const filters: TaskStatus[] = ["inbox", "ready", "working", "waiting", "done"];

type Draft = { title: string; instructions: string; parentTaskId: string | null };
const emptyDraft: Draft = { title: "", instructions: "", parentTaskId: null };

export function Dashboard({
  initialTasks,
  initialWorkers,
  userEmail,
}: {
  initialTasks: Task[];
  initialWorkers: Worker[];
  userEmail: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [workers, setWorkers] = useState(initialWorkers);
  const [filter, setFilter] = useState<TaskStatus>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(initialTasks[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editInstructions, setEditInstructions] = useState("");
  const [workerOpen, setWorkerOpen] = useState(false);
  const [workerToken, setWorkerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.status === filter),
    [filter, tasks],
  );
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const hasLiveRun = tasks.some((task) => task.status === "ready" || task.status === "working");

  const refreshTasks = useCallback(async () => {
    try {
      const body = await requestJson("/api/tasks");
      setTasks(body.tasks);
    } catch {
      // Keep the last good local view during a temporary network failure.
    }
  }, []);

  useEffect(() => {
    if (!hasLiveRun) return;
    const timer = window.setInterval(() => void refreshTasks(), 4000);
    return () => window.clearInterval(timer);
  }, [hasLiveRun, refreshTasks]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const body = await requestJson("/api/tasks", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setTasks((current) => [body.task, ...current]);
      setSelectedId(body.task.id);
      setDraft(emptyDraft);
      setComposerOpen(false);
    });
  }

  async function queueTask(taskId: string) {
    await runAction(async () => {
      await requestJson(`/api/tasks/${taskId}/queue`, { method: "POST" });
      await refreshTasks();
    });
  }

  function startEditing(task: Task) {
    setEditingTask(task);
    setEditInstructions(task.instructions);
  }

  async function updateTask(event: FormEvent) {
    event.preventDefault();
    if (!editingTask) return;
    await runAction(async () => {
      const body = await requestJson(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ instructions: editInstructions }),
      });
      setTasks((current) => current.map((task) => task.id === body.task.id ? body.task : task));
      setEditingTask(null);
      setEditInstructions("");
    });
  }

  async function sendFeedback(taskId: string, feedback: string) {
    await runAction(async () => {
      await requestJson(`/api/tasks/${taskId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback }),
      });
      await refreshTasks();
    });
  }

  async function acceptTask(taskId: string) {
    await runAction(async () => {
      await requestJson(`/api/tasks/${taskId}/accept`, { method: "POST" });
      await refreshTasks();
    });
  }

  function startFollowUp(task: Task) {
    setDraft({
      title: `Follow up: ${task.title}`,
      instructions: buildFollowUpInstructions(task),
      parentTaskId: task.id,
    });
    setComposerOpen(true);
  }

  async function createWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      const body = await requestJson("/api/workers", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name") }),
      });
      setWorkers((current) => [body.worker, ...current]);
      setWorkerToken(body.token);
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">R</span><span>Relay</span></div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Worker setup" onClick={() => setWorkerOpen(true)}><Laptop size={20} /></button>
          <form action="/auth/sign-out" method="post">
            <button className="icon-button" aria-label={`Sign out ${userEmail}`}><LogOut size={19} /></button>
          </form>
        </div>
      </header>

      <section className="workspace">
        <aside className={`task-column ${selected ? "has-selection" : ""}`}>
          <div className="task-column-heading">
            <div><p className="eyebrow">Your relay</p><h1>Tasks in motion</h1></div>
            <button className="new-button" onClick={() => { setDraft(emptyDraft); setComposerOpen(true); }}><Plus size={19} />New</button>
          </div>

          <div className="filter-strip" aria-label="Filter tasks">
            {filters.map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {statusLabel(item)}
                <span>{tasks.filter((task) => task.status === item).length}</span>
              </button>
            ))}
          </div>

          <div className="task-list">
            {visibleTasks.length ? visibleTasks.map((task) => (
              <button key={task.id} className={`task-card ${selectedId === task.id ? "selected" : ""}`} onClick={() => setSelectedId(task.id)}>
                <div className="task-card-top"><StatusPill status={task.status} /><span>{relativeDate(task.updated_at)}</span></div>
                <h2>{task.title}</h2>
                <p>{plainPreview(task.instructions)}</p>
                <div className="task-card-bottom">
                  <span>{task.runs.length ? `${task.runs.length} ${task.runs.length === 1 ? "run" : "runs"}` : "Not run yet"}</span>
                  <ChevronRight size={18} />
                </div>
              </button>
            )) : (
              <div className="empty-state">
                <div className="empty-orbit"><Sparkles size={24} /></div>
                <h2>{tasks.length ? "Nothing in this view" : "Start with one clear task"}</h2>
                <p>{tasks.length ? "Choose another status to see more tasks." : "Write the outcome and context. Your laptop can take it from there."}</p>
                {!tasks.length && <button className="primary-button compact" onClick={() => setComposerOpen(true)}><Plus size={18} />Create a task</button>}
              </div>
            )}
          </div>
        </aside>

        <section className={`detail-panel ${selected ? "open" : ""}`}>
          {selected ? (
            <TaskDetail
              key={`${selected.id}-${selected.updated_at}`}
              task={selected}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onQueue={() => queueTask(selected.id)}
              onFeedback={(feedback) => sendFeedback(selected.id, feedback)}
              onAccept={() => acceptTask(selected.id)}
              onFollowUp={() => startFollowUp(selected)}
              onEdit={() => startEditing(selected)}
            />
          ) : (
            <div className="detail-placeholder"><CircleDot size={30} /><h2>Select a task</h2><p>Its durable context and run results will appear here.</p></div>
          )}
        </section>
      </section>

      {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}

      {composerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setComposerOpen(false)}>
          <section className="sheet composer" role="dialog" aria-modal="true" aria-labelledby="new-task-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">{draft.parentTaskId ? "From accepted result" : "Capture"}</p><h2 id="new-task-title">{draft.parentTaskId ? "Create follow-up" : "New task"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)}><X size={20} /></button></div>
            <form onSubmit={createTask}>
              <label htmlFor="task-title">Task title</label>
              <input id="task-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs to be true?" autoFocus required maxLength={160} />
              <label htmlFor="task-instructions">Markdown instructions and context</label>
              <textarea id="task-instructions" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder={"## Outcome\nDescribe the result you want.\n\n## Context\nAdd useful constraints and background."} required rows={14} />
              <div className="composer-hint"><span>Markdown supported</span><span>{draft.instructions.length.toLocaleString()} characters</span></div>
              <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save to Inbox"}<ArrowRight size={18} /></button>
            </form>
          </section>
        </div>
      )}

      {editingTask && (
        <div className="modal-backdrop" onMouseDown={() => setEditingTask(null)}>
          <section className="sheet composer" role="dialog" aria-modal="true" aria-labelledby="edit-task-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Task document</p><h2 id="edit-task-title">Edit Markdown</h2></div><button className="icon-button" onClick={() => setEditingTask(null)} aria-label="Cancel editing"><X size={20} /></button></div>
            <form onSubmit={updateTask}>
              <label htmlFor="edit-task-instructions">Markdown instructions and context</label>
              <textarea id="edit-task-instructions" value={editInstructions} onChange={(event) => setEditInstructions(event.target.value)} required maxLength={100000} rows={14} autoFocus />
              <div className="composer-hint"><span>Markdown supported</span><span>{editInstructions.length.toLocaleString()} characters</span></div>
              <div className="edit-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingTask(null)}>Cancel</button><button className="primary-button" disabled={busy || !editInstructions.trim()}>{busy ? "Saving…" : "Save changes"}<Check size={18} /></button></div>
            </form>
          </section>
        </div>
      )}

      {workerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setWorkerOpen(false)}>
          <section className="sheet worker-sheet" role="dialog" aria-modal="true" aria-labelledby="worker-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Outbound only</p><h2 id="worker-title">Worker setup</h2></div><button className="icon-button" onClick={() => setWorkerOpen(false)}><X size={20} /></button></div>
            <p className="sheet-intro">Your laptop polls Relay securely. Nothing needs to connect inbound to your machine.</p>
            {workers.length > 0 && <div className="worker-list">{workers.map((worker) => <div key={worker.id}><span className={`worker-dot ${worker.last_seen_at ? "seen" : ""}`} /><div><strong>{worker.name}</strong><p>{worker.last_seen_at ? `Seen ${relativeDate(worker.last_seen_at)}` : "Not connected yet"}</p></div></div>)}</div>}
            {workerToken ? (
              <div className="token-panel"><p>Copy this token now. Relay stores only its hash.</p><code>{workerToken}</code><button className="secondary-button" onClick={() => navigator.clipboard.writeText(workerToken)}><Copy size={17} />Copy token</button></div>
            ) : (
              <form onSubmit={createWorker}><label htmlFor="worker-name">Laptop name</label><input id="worker-name" name="name" placeholder="My laptop" required maxLength={80} /><button className="primary-button" disabled={busy}><Laptop size={18} />Create worker token</button></form>
            )}
            <p className="privacy-note">Use this token only in the local worker environment. Never commit it.</p>
          </section>
        </div>
      )}
    </main>
  );
}

function TaskDetail({ task, busy, onBack, onQueue, onFeedback, onAccept, onFollowUp, onEdit }: {
  task: Task;
  busy: boolean;
  onBack: () => void;
  onQueue: () => void;
  onFeedback: (feedback: string) => void;
  onAccept: () => void;
  onFollowUp: () => void;
  onEdit: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const latest = latestCompletedRun(task.runs);
  const active = task.runs.find((run) => run.status === "working" || run.status === "queued");
  const failed = [...task.runs].sort((a, b) => b.attempt - a.attempt).find((run) => run.status === "failed");

  return (
    <div className="detail-content">
      <div className="mobile-detail-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={18} />Tasks</button><StatusPill status={task.status} /></div>
      <div className="detail-heading"><div><StatusPill status={task.status} /><h1>{task.title}</h1><p>Updated {formatDate(task.updated_at)}{task.parent_task_id ? " · Follow-up task" : ""}</p></div>
        {(task.status === "inbox" || (task.status === "waiting" && !latest)) && <button className="primary-button compact" disabled={busy} onClick={onQueue}><Send size={17} />Queue run</button>}
      </div>

      <section className="document-section"><div className="section-label"><span>Task document</span><button className="document-edit-button" disabled={busy} onClick={onEdit}><Pencil size={14} />Edit</button></div><div className="markdown"><ReactMarkdown>{task.instructions}</ReactMarkdown></div></section>

      {active && <section className="run-status-card"><div className="run-spinner"><RefreshCw size={22} /></div><div><p className="eyebrow">Attempt {active.attempt}</p><h2>{active.status === "queued" ? "Waiting for your laptop" : "Worker is on it"}</h2><p>{active.status === "queued" ? "This run stays safely queued while your worker is offline." : "The result will appear here when the worker finishes."}</p></div></section>}

      {failed && !active && !latest && <section className="error-card"><p className="eyebrow">Attempt {failed.attempt} failed</p><h2>The worker could not finish this run.</h2><p>{failed.error}</p><button className="secondary-button" disabled={busy} onClick={onQueue}><RefreshCw size={17} />Try again</button></section>}

      {latest && task.status !== "done" && (
        <section className="result-section">
          <div className="section-label"><span>Result · attempt {latest.attempt}</span><span>{latest.finished_at ? formatDate(latest.finished_at) : "Ready to review"}</span></div>
          <div className="markdown result-markdown"><ReactMarkdown>{latest.result_markdown}</ReactMarkdown></div>
          {latest.result_artifacts.length > 0 && <div className="artifact-list">{latest.result_artifacts.map((artifact, index) => <a key={`${artifact.type}-${index}`} href={artifact.url} target="_blank" rel="noreferrer"><span>{artifact.type.replace("_", " ")}</span><strong>{artifact.label}</strong><ChevronRight size={17} /></a>)}</div>}
          <div className="review-actions"><label htmlFor="feedback">Feedback for another run</label><textarea id="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="What should change or be explored next?" rows={4} /><div><button className="secondary-button" disabled={busy || !feedback.trim()} onClick={() => onFeedback(feedback)}><RefreshCw size={17} />Run again</button><button className="accept-button" disabled={busy} onClick={onAccept}><Check size={18} />Accept result</button></div></div>
        </section>
      )}

      {task.status === "done" && task.accepted_result && <section className="result-section accepted"><div className="accepted-heading"><div><Check size={18} /><span>Accepted result</span></div><button className="secondary-button compact" onClick={onFollowUp}><Plus size={17} />Follow-up</button></div><div className="markdown result-markdown"><ReactMarkdown>{task.accepted_result}</ReactMarkdown></div></section>}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const Icon = status === "working" ? RefreshCw : status === "waiting" ? Clock3 : status === "done" ? Check : CircleDot;
  return <span className={`status-pill ${status}`}><Icon size={13} />{statusLabel(status)}</span>;
}

function plainPreview(markdown: string) {
  return markdown.replace(/[#>*_`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 130);
}

function relativeDate(value: string) {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Relay could not complete that action.");
  return body;
}
