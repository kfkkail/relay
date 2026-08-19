"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Laptop,
  Image as ImageIcon,
  LogOut,
  Pencil,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserRoundCheck,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildFollowUpInstructions, compareOwnerActions, latestCompletedRun, ownerActionFilter, statusLabel } from "@/lib/domain";
import { localDateTimeToUtc, nextLocalDateTimeMinute, utcToLocalDateTime } from "@/lib/date-time";
import type { OwnerAction, Task, TaskStatus, Worker } from "@/lib/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

const filters: TaskStatus[] = ["inbox", "ready", "working", "waiting", "done"];

type Draft = { title: string; instructions: string; parentTaskId: string | null; ownerActionId: string | null };
const emptyDraft: Draft = { title: "", instructions: "", parentTaskId: null, ownerActionId: null };

export function Dashboard({
  initialTasks,
  initialWorkers,
  initialOwnerActions,
  userEmail,
}: {
  initialTasks: Task[];
  initialWorkers: Worker[];
  initialOwnerActions: OwnerAction[];
  userEmail: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [workers, setWorkers] = useState(initialWorkers);
  const [ownerActions, setOwnerActions] = useState(initialOwnerActions);
  const [area, setArea] = useState<"tasks" | "my-work">("tasks");
  const [filter, setFilter] = useState<TaskStatus>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(initialTasks[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftImage, setDraftImage] = useState<File | null>(null);
  const [pendingTask, setPendingTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedOwnerActionId, setSelectedOwnerActionId] = useState<string | null>(null);
  const [editingOwnerAction, setEditingOwnerAction] = useState(false);
  const [ownerActionTitle, setOwnerActionTitle] = useState("");
  const [ownerActionNotes, setOwnerActionNotes] = useState("");
  const [ownerActionDueAt, setOwnerActionDueAt] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editImage, setEditImage] = useState<File | null>(null);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [workerToken, setWorkerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.status === filter),
    [filter, tasks],
  );
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const selectedOwnerAction = ownerActions.find((action) => action.id === selectedOwnerActionId) ?? null;
  const hasLiveRun = tasks.some((task) => task.status === "ready" || task.status === "working");

  const refreshTasks = useCallback(async () => {
    try {
      const body = await requestJson("/api/tasks");
      setTasks(body.tasks);
    } catch {
      // Keep the last good local view during a temporary network failure.
    }
  }, []);

  const refreshOwnerActions = useCallback(async () => {
    const body = await requestJson("/api/owner-actions?pageSize=100");
    setOwnerActions(body.actions);
  }, []);

  async function createOwnerAction(input: { title: string; notes?: string; dueAt?: string | null; taskId?: string }) {
    const body = await requestJson("/api/owner-actions", { method: "POST", body: JSON.stringify(input) });
    let action = body.action as OwnerAction;
    if (input.taskId) {
      const linked = await requestJson(`/api/owner-actions/${action.id}/tasks`, { method: "POST", body: JSON.stringify({ taskId: input.taskId }) });
      action = linked.action;
    }
    setOwnerActions((current) => [...current, action]);
  }

  async function updateOwnerAction(actionId: string, updates: Record<string, unknown>) {
    const body = await requestJson(`/api/owner-actions/${actionId}`, { method: "PATCH", body: JSON.stringify(updates) });
    setOwnerActions((current) => current.map((action) => action.id === actionId ? body.action : action));
  }

  async function deleteOwnerAction(actionId: string) {
    await requestJson(`/api/owner-actions/${actionId}`, { method: "DELETE" });
    setOwnerActions((current) => current.filter((action) => action.id !== actionId));
  }

  async function linkOwnerAction(actionId: string, taskId: string) {
    const body = await requestJson(`/api/owner-actions/${actionId}/tasks`, { method: "POST", body: JSON.stringify({ taskId }) });
    setOwnerActions((current) => current.map((action) => action.id === actionId ? body.action : action));
  }

  async function unlinkOwnerAction(actionId: string, taskId: string) {
    await requestJson(`/api/owner-actions/${actionId}/tasks/${taskId}`, { method: "DELETE" });
    await refreshOwnerActions();
  }

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
      const task = pendingTask ?? (await requestJson("/api/tasks", {
        method: "POST", body: JSON.stringify(draft),
      })).task as Task;
      setPendingTask(task);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedId(task.id);
      if (draftImage) task.task_attachments = [await uploadAttachment(task.id, draftImage)];
      if (draft.ownerActionId) await linkOwnerAction(draft.ownerActionId, task.id);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setDraft(emptyDraft);
      setDraftImage(null);
      setPendingTask(null);
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
    setEditTitle(task.title);
    setEditInstructions(task.instructions);
    setEditImage(null);
  }

  function openTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setArea("tasks");
    setFilter(task.status);
    setSelectedId(task.id);
    setSelectedOwnerActionId(null);
  }

  function openOwnerAction(actionId: string) {
    setSelectedOwnerActionId(actionId);
    setEditingOwnerAction(false);
  }

  function startEditingOwnerAction() {
    if (!selectedOwnerAction) return;
    setOwnerActionTitle(selectedOwnerAction.title);
    setOwnerActionNotes(selectedOwnerAction.notes);
    setOwnerActionDueAt(utcToLocalDateTime(selectedOwnerAction.due_at));
    setEditingOwnerAction(true);
  }

  async function saveOwnerAction(event: FormEvent) {
    event.preventDefault();
    if (!selectedOwnerAction) return;
    await runAction(async () => {
      await updateOwnerAction(selectedOwnerAction.id, { title: ownerActionTitle, notes: ownerActionNotes, dueAt: ownerActionDueAt ? localDateTimeToUtc(ownerActionDueAt) : null });
      setEditingOwnerAction(false);
    });
  }

  async function updateTask(event: FormEvent) {
    event.preventDefault();
    if (!editingTask) return;
    await runAction(async () => {
      const body = await requestJson(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: editTitle, instructions: editInstructions }),
      });
      if (editImage) {
        const existing = editingTask.task_attachments[0];
        if (existing) await requestJson(`/api/tasks/${editingTask.id}/attachments/${existing.id}`, { method: "DELETE" });
        body.task.task_attachments = [await uploadAttachment(editingTask.id, editImage)];
      }
      setTasks((current) => current.map((task) => task.id === body.task.id ? body.task : task));
      setEditingTask(null);
      setEditTitle("");
      setEditInstructions("");
      setEditImage(null);
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
      ownerActionId: null,
    });
    setComposerOpen(true);
  }

  function startTaskFromOwnerAction(action: OwnerAction) {
    setDraft({
      title: action.title,
      instructions: action.notes || `Complete the owner action: ${action.title}`,
      parentTaskId: null,
      ownerActionId: action.id,
    });
    setDraftImage(null);
    setPendingTask(null);
    setSelectedOwnerActionId(null);
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
        <nav className="area-nav" aria-label="Main navigation"><button className={area === "tasks" ? "active" : ""} onClick={() => setArea("tasks")}>Tasks</button><button className={area === "my-work" ? "active" : ""} onClick={() => setArea("my-work")}>My Work</button></nav>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Worker setup" onClick={() => setWorkerOpen(true)}><Laptop size={20} /></button>
          <form action="/auth/sign-out" method="post">
            <button className="icon-button" aria-label={`Sign out ${userEmail}`}><LogOut size={19} /></button>
          </form>
        </div>
      </header>

      {area === "my-work" ? <MyWork actions={ownerActions} busy={busy} runAction={runAction} onCreate={createOwnerAction} onUpdate={updateOwnerAction} onDelete={deleteOwnerAction} onOpenAction={openOwnerAction} onOpenTask={openTask} /> : <section className="workspace">
        <aside className={`task-column ${selected ? "has-selection" : ""}`}>
          <div className="task-column-heading">
            <div><p className="eyebrow">Your relay</p><h1>Tasks in motion</h1></div>
            <button className="new-button" onClick={() => { setDraft(emptyDraft); setDraftImage(null); setPendingTask(null); setComposerOpen(true); }}><Plus size={19} />New</button>
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
              ownerActions={ownerActions}
              onCreateOwnerAction={(title) => runAction(() => createOwnerAction({ title, taskId: selected.id }))}
              onUpdateOwnerAction={(actionId, updates) => runAction(() => updateOwnerAction(actionId, updates))}
              onLinkOwnerAction={(actionId) => runAction(() => linkOwnerAction(actionId, selected.id))}
              onUnlinkOwnerAction={(actionId) => runAction(() => unlinkOwnerAction(actionId, selected.id))}
              onOpenOwnerAction={openOwnerAction}
            />
          ) : (
            <div className="detail-placeholder"><CircleDot size={30} /><h2>Select a task</h2><p>Its durable context and run results will appear here.</p></div>
          )}
        </section>
      </section>}

      {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}

      {composerOpen && (
        <div className="modal-backdrop" onMouseDown={() => setComposerOpen(false)}>
          <section className="sheet composer" role="dialog" aria-modal="true" aria-labelledby="new-task-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">{draft.parentTaskId ? "From accepted result" : draft.ownerActionId ? "From owner action" : "Capture"}</p><h2 id="new-task-title">{draft.parentTaskId ? "Create follow-up" : "New task"}</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)}><X size={20} /></button></div>
            <form onSubmit={createTask}>
              <label htmlFor="task-title">Task title</label>
              <input id="task-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs to be true?" autoFocus required maxLength={160} />
              <label htmlFor="task-instructions">Markdown instructions and context</label>
              <textarea id="task-instructions" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder={"## Outcome\nDescribe the result you want.\n\n## Context\nAdd useful constraints and background."} required rows={14} />
              <div className="composer-hint"><span>Markdown supported</span><span>{draft.instructions.length.toLocaleString()} characters</span></div>
              <ImagePicker file={draftImage} onChange={setDraftImage} />
              <button className="primary-button" disabled={busy}>{busy ? "Saving and uploading…" : "Save to Inbox"}<ArrowRight size={18} /></button>
            </form>
          </section>
        </div>
      )}

      {editingTask && (
        <div className="modal-backdrop" onMouseDown={() => setEditingTask(null)}>
          <section className="sheet composer" role="dialog" aria-modal="true" aria-labelledby="edit-task-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Task details</p><h2 id="edit-task-title">Edit task</h2></div><button className="icon-button" onClick={() => setEditingTask(null)} aria-label="Cancel editing"><X size={20} /></button></div>
            <form onSubmit={updateTask}>
              <label htmlFor="edit-task-name">Task title</label>
              <input id="edit-task-name" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={160} autoFocus />
              <label htmlFor="edit-task-instructions">Markdown instructions and context</label>
              <textarea id="edit-task-instructions" value={editInstructions} onChange={(event) => setEditInstructions(event.target.value)} required maxLength={100000} rows={14} />
              <div className="composer-hint"><span>Markdown supported</span><span>{editInstructions.length.toLocaleString()} characters</span></div>
              {editingTask.status === "inbox" && <ImagePicker file={editImage} onChange={setEditImage} currentName={editingTask.task_attachments[0]?.file_name} />}
              <div className="edit-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingTask(null)}>Cancel</button><button className="primary-button" disabled={busy || !editTitle.trim() || !editInstructions.trim()}>{busy ? "Saving…" : "Save changes"}<Check size={18} /></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedOwnerAction && (
        <div className="modal-backdrop" onMouseDown={() => setSelectedOwnerActionId(null)}>
          <section className="sheet owner-action-sheet" role="dialog" aria-modal="true" aria-labelledby="owner-action-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-heading"><div><p className="eyebrow">Owner action</p><h2 id="owner-action-detail-title">{editingOwnerAction ? "Edit action" : selectedOwnerAction.title}</h2></div><button className="icon-button" onClick={() => setSelectedOwnerActionId(null)} aria-label="Close action"><X size={20} /></button></div>
            {editingOwnerAction ? <form onSubmit={saveOwnerAction}>
              <label htmlFor="detail-owner-action-title">Action title</label><input id="detail-owner-action-title" value={ownerActionTitle} onChange={(event) => setOwnerActionTitle(event.target.value)} required maxLength={160} autoFocus />
              <label htmlFor="detail-owner-action-notes">Notes (optional)</label><textarea id="detail-owner-action-notes" value={ownerActionNotes} onChange={(event) => setOwnerActionNotes(event.target.value)} maxLength={20000} rows={5} />
              <label htmlFor="detail-owner-action-due">Due date (optional)</label><input id="detail-owner-action-due" type="datetime-local" value={ownerActionDueAt} onChange={(event) => setOwnerActionDueAt(event.target.value)} />
              <div className="edit-actions"><button type="button" className="secondary-button" onClick={() => setEditingOwnerAction(false)}>Cancel</button><button className="primary-button" disabled={busy}>Save changes<Check size={18} /></button></div>
            </form> : <div className="owner-action-detail">
              <div className="action-meta"><span className={`owner-status ${selectedOwnerAction.status}`}>{ownerActionStatusLabel(selectedOwnerAction)}</span>{selectedOwnerAction.due_at && <span><CalendarDays size={13} />Due {formatDate(selectedOwnerAction.due_at)}</span>}</div>
              <section><h3>Notes</h3><p>{selectedOwnerAction.notes || "No notes added."}</p></section>
              <section><h3>Linked tasks</h3>{selectedOwnerAction.owner_action_tasks.length ? <div className="owner-action-links">{selectedOwnerAction.owner_action_tasks.map((link) => link.tasks && <button key={link.task_id} onClick={() => openTask(link.task_id)}>{link.tasks.title}<ChevronRight size={16} /></button>)}</div> : <p>No linked tasks.</p>}</section>
              <div className="edit-actions"><button className="secondary-button" disabled={busy} onClick={() => startTaskFromOwnerAction(selectedOwnerAction)}><Plus size={17} />Create task</button><button className="primary-button" disabled={busy} onClick={startEditingOwnerAction}><Pencil size={17} />Edit action</button></div>
            </div>}
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

function MyWork({ actions, busy, runAction, onCreate, onUpdate, onDelete, onOpenAction, onOpenTask }: {
  actions: OwnerAction[];
  busy: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onCreate: (input: { title: string; notes?: string; dueAt?: string | null }) => Promise<void>;
  onUpdate: (actionId: string, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (actionId: string) => Promise<void>;
  onOpenAction: (actionId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [filter, setFilter] = useState<"active" | "snoozed" | "done">("active");
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [query, setQuery] = useState("");
  const [snoozing, setSnoozing] = useState<OwnerAction | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [hideStartedAt, setHideStartedAt] = useState(0);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return actions.filter((action) => ownerActionFilter(action) === filter)
      .filter((action) => !normalized || [action.title, action.notes, ...action.owner_action_tasks.map((link) => link.tasks?.title ?? "")].some((value) => value.toLocaleLowerCase().includes(normalized)))
      .sort((a, b) => compareOwnerActions(a, b));
  }, [actions, filter, query]);

  async function remove(action: OwnerAction) {
    if (!window.confirm(`Delete “${action.title}”? This cannot be undone.`)) return;
    await runAction(() => onDelete(action.id));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await onCreate({ title, notes, dueAt: dueAt ? localDateTimeToUtc(dueAt) : null });
      setTitle(""); setNotes(""); setDueAt(""); setComposerOpen(false);
    });
  }

  function startHiding(action: OwnerAction) {
    const startedAt = Date.now();
    const tomorrow = new Date(startedAt + 86400000);
    const initial = action.due_at && new Date(action.due_at) < tomorrow ? action.due_at : tomorrow.toISOString();
    setHideStartedAt(startedAt);
    setSnoozing(action);
    setSnoozeUntil(utcToLocalDateTime(initial));
  }

  function quickHide(days: number) {
    setSnoozeUntil(utcToLocalDateTime(new Date(hideStartedAt + days * 86400000).toISOString()));
  }

  return <section className="my-work-view">
    <div className="my-work-heading"><div><p className="eyebrow">Owner actions</p><h1>My Work</h1></div><button className="new-button" onClick={() => { setTitle(""); setNotes(""); setDueAt(""); setComposerOpen(true); }}><Plus size={19} />New action</button></div>
    <div className="filter-strip" aria-label="Filter owner actions">{(["active", "snoozed", "done"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}<span>{actions.filter((action) => ownerActionFilter(action) === item).length}</span></button>)}</div>
    <label className="owner-action-search"><Search size={17} /><span className="sr-only">Search My Work</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions and linked tasks" /></label>
    <div className="owner-action-list">{visible.length ? visible.map((action) => <article className="owner-action-card" key={action.id}>
      <button className="completion-button" aria-label={action.status === "done" ? `Reopen ${action.title}` : `Complete ${action.title}`} disabled={busy} onClick={() => runAction(() => onUpdate(action.id, { status: action.status === "done" ? "todo" : "done" }))}>{action.status === "done" ? <Check size={18} /> : <CircleDot size={18} />}</button>
      <div className="owner-action-copy"><button className="owner-action-title" onClick={() => onOpenAction(action.id)}><h2>{action.title}</h2></button>{action.notes && <p>{action.notes}</p>}<div className="action-meta"><span className={`owner-status ${action.status}`}>{ownerActionStatusLabel(action)}</span>{filter === "snoozed" && action.snoozed_until && <span><Clock3 size={13} />Returns {formatDate(action.snoozed_until)}</span>}{action.due_at && <span className={new Date(action.due_at) <= new Date() && action.status !== "done" ? "overdue" : ""}><CalendarDays size={13} />Due {formatDate(action.due_at)}</span>}<span>{action.owner_action_tasks.length} linked {action.owner_action_tasks.length === 1 ? "task" : "tasks"}</span></div>{action.owner_action_tasks.length > 0 && <div className="linked-task-titles">{action.owner_action_tasks.map((link) => link.tasks && <button key={link.task_id} onClick={() => onOpenTask(link.task_id)}>{link.tasks.title}</button>)}</div>}</div>
      <div className="action-controls">{action.status !== "done" && <button onClick={() => runAction(() => onUpdate(action.id, { status: action.status === "todo" ? "in_progress" : "todo" }))}>{action.status === "todo" ? "Start" : "To do"}</button>}{filter === "snoozed" ? <button onClick={() => runAction(() => onUpdate(action.id, { snoozedUntil: null }))}>Show now</button> : action.status !== "done" && <button disabled={Boolean(action.due_at && new Date(action.due_at) <= new Date())} title={action.due_at && new Date(action.due_at) <= new Date() ? "This action is already due and must stay visible." : undefined} onClick={() => startHiding(action)}>Hide until</button>}<button className="danger-control" aria-label={`Delete ${action.title}`} onClick={() => remove(action)}><Trash2 size={13} /></button>{filter !== "snoozed" && action.status !== "done" && action.due_at && new Date(action.due_at) <= new Date() && <span className="hide-disabled-note">Already due — cannot be hidden.</span>}</div>
    </article>) : <div className="empty-state"><div className="empty-orbit"><UserRoundCheck size={24} /></div><h2>{query ? "No actions match your search." : "Nothing needs you right now."}</h2></div>}</div>
    {composerOpen && <div className="modal-backdrop" onMouseDown={() => setComposerOpen(false)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="new-action-title" onMouseDown={(event) => event.stopPropagation()}><div className="sheet-heading"><div><p className="eyebrow">My Work</p><h2 id="new-action-title">New action</h2></div><button className="icon-button" onClick={() => setComposerOpen(false)}><X size={20} /></button></div><form onSubmit={create}><label htmlFor="owner-action-title">Action title</label><input id="owner-action-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} autoFocus /><label htmlFor="owner-action-notes">Notes (optional)</label><textarea id="owner-action-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={20000} rows={5} /><label htmlFor="owner-action-due">Due date (optional)</label><input id="owner-action-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /><button className="primary-button" disabled={busy}>Create action<ArrowRight size={18} /></button></form></section></div>}
    {snoozing && <div className="modal-backdrop" onMouseDown={() => setSnoozing(null)}><section className="sheet small-sheet" role="dialog" aria-modal="true" aria-labelledby="hide-action-title" onMouseDown={(event) => event.stopPropagation()}><div className="sheet-heading"><div><p className="eyebrow">Remind me on</p><h2 id="hide-action-title">Hide {snoozing.title}</h2></div><button className="icon-button" onClick={() => setSnoozing(null)}><X size={20} /></button></div><form onSubmit={(event) => { event.preventDefault(); void runAction(async () => { await onUpdate(snoozing.id, { snoozedUntil: localDateTimeToUtc(snoozeUntil) }); setSnoozing(null); }); }}><p className="sheet-intro">The due date will not change. This action returns to Active at the selected time or when it is due, whichever comes first.</p><div className="hide-quick-choices"><button type="button" disabled={Boolean(snoozing.due_at && new Date(hideStartedAt + 86400000) > new Date(snoozing.due_at))} onClick={() => quickHide(1)}>Tomorrow</button><button type="button" disabled={Boolean(snoozing.due_at && new Date(hideStartedAt + 7 * 86400000) > new Date(snoozing.due_at))} onClick={() => quickHide(7)}>Next week</button></div><label htmlFor="hide-until">Pick date and time</label><input id="hide-until" type="datetime-local" min={nextLocalDateTimeMinute(new Date(hideStartedAt))} max={utcToLocalDateTime(snoozing.due_at)} value={snoozeUntil} onChange={(event) => setSnoozeUntil(event.target.value)} required autoFocus /><button className="primary-button" disabled={busy}>Hide action<Clock3 size={18} /></button></form></section></div>}
  </section>;
}

function TaskDetail({ task, busy, onBack, onQueue, onFeedback, onAccept, onFollowUp, onEdit, ownerActions, onCreateOwnerAction, onUpdateOwnerAction, onLinkOwnerAction, onUnlinkOwnerAction, onOpenOwnerAction }: {
  task: Task;
  busy: boolean;
  onBack: () => void;
  onQueue: () => void;
  onFeedback: (feedback: string) => void;
  onAccept: () => void;
  onFollowUp: () => void;
  onEdit: () => void;
  ownerActions: OwnerAction[];
  onCreateOwnerAction: (title: string) => void;
  onUpdateOwnerAction: (actionId: string, updates: Record<string, unknown>) => void;
  onLinkOwnerAction: (actionId: string) => void;
  onUnlinkOwnerAction: (actionId: string) => void;
  onOpenOwnerAction: (actionId: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const latest = latestCompletedRun(task.runs);
  const active = task.runs.find((run) => run.status === "working" || run.status === "queued");
  const failed = [...task.runs].sort((a, b) => b.attempt - a.attempt).find((run) => run.status === "failed");
  const linkedActions = ownerActions.filter((action) => action.owner_action_tasks.some((link) => link.task_id === task.id));
  const availableActions = ownerActions.filter((action) => action.status !== "done" && !linkedActions.includes(action));

  return (
    <div className="detail-content">
      <div className="mobile-detail-bar"><button className="back-button" onClick={onBack}><ArrowLeft size={18} />Tasks</button><StatusPill status={task.status} /></div>
      <div className="detail-heading"><div><StatusPill status={task.status} /><h1>{task.title}</h1><p>Updated {formatDate(task.updated_at)}{task.parent_task_id ? " · Follow-up task" : ""}</p></div>
        {(task.status === "inbox" || (task.status === "waiting" && !latest)) && <button className="primary-button compact" disabled={busy} onClick={onQueue}><Send size={17} />Queue run</button>}
      </div>

      <section className="document-section"><div className="section-label"><span>Task document</span><button className="document-edit-button" disabled={busy} onClick={onEdit}><Pencil size={14} />Edit</button></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{task.instructions}</ReactMarkdown></div></section>

      {task.task_attachments.map((attachment) => <section className="attachment-section" key={attachment.id}>
        <div className="section-label"><span>Attached image</span><span>{formatBytes(attachment.byte_size)}</span></div>
        <a href={`/api/tasks/${task.id}/attachments/${attachment.id}`} target="_blank" rel="noreferrer">
          {/* Authenticated endpoint; filename is rendered as plain text and never used as markup. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated dynamic image endpoint */}
          <img src={`/api/tasks/${task.id}/attachments/${attachment.id}`} alt={attachment.file_name} />
          <span><ImageIcon size={16} />{attachment.file_name} · Open full size</span>
        </a>
      </section>)}

      <section className="your-actions-section"><div className="section-label"><span>Your actions</span><button className="document-edit-button" disabled={busy} onClick={() => onCreateOwnerAction(`Action for ${task.title}`)}><Plus size={14} />Create linked</button></div>{linkedActions.length ? <div className="task-actions-list">{linkedActions.map((action) => <div key={action.id}><div><button className="linked-action-title" onClick={() => onOpenOwnerAction(action.id)}>{action.title}</button><span>{ownerActionStatusLabel(action)}</span></div><div><button onClick={() => onUpdateOwnerAction(action.id, { status: action.status === "done" ? "todo" : "done" })}>{action.status === "done" ? "Reopen" : "Complete"}</button><button onClick={() => onUnlinkOwnerAction(action.id)}>Unlink</button></div></div>)}</div> : <p className="no-actions">No owner actions are linked to this task.</p>}{availableActions.length > 0 && <label className="link-existing">Link existing action<select defaultValue="" onChange={(event) => { if (event.target.value) onLinkOwnerAction(event.target.value); event.target.value = ""; }}><option value="" disabled>Choose an action…</option>{availableActions.map((action) => <option key={action.id} value={action.id}>{action.title}</option>)}</select></label>}</section>

      {active && <section className="run-status-card"><div className="run-spinner"><RefreshCw size={22} /></div><div><p className="eyebrow">Attempt {active.attempt}</p><h2>{active.status === "queued" ? "Waiting for your laptop" : "Worker is on it"}</h2><p>{active.status === "queued" ? "This run stays safely queued while your worker is offline." : "The result will appear here when the worker finishes."}</p></div></section>}

      {failed && !active && !latest && <section className="error-card"><p className="eyebrow">Attempt {failed.attempt} failed</p><h2>The worker could not finish this run.</h2><p>{failed.error}</p><div className="handoff-actions"><button className="secondary-button" disabled={busy} onClick={onQueue}><RefreshCw size={17} />Try again</button><button className="secondary-button" disabled={busy} onClick={() => onCreateOwnerAction(`Decide whether to retry ${task.title}`)}><UserRoundCheck size={17} />Add to My Work</button></div></section>}

      {latest && task.status !== "done" && (
        <section className="result-section">
          <div className="section-label"><span>Result · attempt {latest.attempt}</span><span>{latest.finished_at ? formatDate(latest.finished_at) : "Ready to review"}</span></div>
          <div className="markdown result-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{latest.result_markdown}</ReactMarkdown></div>
          <div className="result-handoff"><button className="secondary-button compact" disabled={busy} onClick={() => onCreateOwnerAction(`Review ${task.title}`)}><UserRoundCheck size={17} />Add to My Work</button></div>
          {latest.result_artifacts.length > 0 && <div className="artifact-list">{latest.result_artifacts.map((artifact, index) => <a key={`${artifact.type}-${index}`} href={artifact.url} target="_blank" rel="noreferrer"><span>{artifact.type.replace("_", " ")}</span><strong>{artifact.label}</strong><ChevronRight size={17} /></a>)}</div>}
          <div className="review-actions"><label htmlFor="feedback">Feedback for another run</label><textarea id="feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="What should change or be explored next?" rows={4} /><div><button className="secondary-button" disabled={busy || !feedback.trim()} onClick={() => onFeedback(feedback)}><RefreshCw size={17} />Run again</button><button className="accept-button" disabled={busy} onClick={onAccept}><Check size={18} />Accept</button></div></div>
        </section>
      )}

      {task.status === "done" && task.accepted_result && <section className="result-section accepted"><div className="accepted-heading"><div><Check size={18} /><span>Accepted result</span></div><button className="secondary-button compact" onClick={onFollowUp}><Plus size={17} />Follow-up</button></div><div className="markdown result-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{task.accepted_result}</ReactMarkdown></div></section>}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const Icon = status === "working" ? RefreshCw : status === "waiting" ? Clock3 : status === "done" ? Check : CircleDot;
  return <span className={`status-pill ${status}`}><Icon size={13} />{statusLabel(status)}</span>;
}

function ImagePicker({ file, onChange, currentName }: { file: File | null; onChange: (file: File | null) => void; currentName?: string }) {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <div className="image-picker">
    <label htmlFor="task-image"><Paperclip size={15} />{currentName ? "Replace image" : "Attach image"}</label>
    <input id="task-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    {(file || currentName) && <div className="image-preview">
      {preview ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img src={preview} alt="Selected upload preview" />
      </> : <ImageIcon size={28} />}
      <div><strong>{file?.name ?? currentName}</strong>{file && <span>{formatBytes(file.size)}</span>}</div>
      {file && <button type="button" onClick={() => onChange(null)} aria-label="Remove selected image"><X size={17} /></button>}
    </div>}
    <p>JPEG, PNG, or WebP · up to 10 MB</p>
  </div>;
}

async function uploadAttachment(taskId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Images must be JPEG, PNG, or WebP.");
  const created = await requestJson(`/api/tasks/${taskId}/attachments`, {
    method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size }),
  });
  try {
    const { error } = await createSupabaseClient().storage.from("task-attachments").uploadToSignedUrl(created.path, created.token, file, { contentType: file.type });
    if (error) throw error;
    const finalized = await requestJson(`/api/tasks/${taskId}/attachments`, {
      method: "PATCH", body: JSON.stringify({ attachmentId: created.attachmentId }),
    });
    return finalized.attachment;
  } catch (error) {
    await requestJson(`/api/tasks/${taskId}/attachments/${created.attachmentId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function ownerActionStatusLabel(action: OwnerAction) {
  return action.status === "in_progress" ? "In progress" : action.status === "todo" ? "To do" : "Done";
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
