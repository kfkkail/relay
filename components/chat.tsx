"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./chat.module.css";

type Conversation = { id: string; title: string };
type Turn = {
  id: string;
  chat_message: string;
  runs: {
    status: string;
    result_markdown: string | null;
    error: string | null;
  }[];
};

export function Chat({ initialId = null }: { initialId?: string | null }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [id, setId] = useState<string | null>(initialId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  // Reuse IDs on network failure so retrying cannot enqueue a duplicate turn.
  const pending = useRef<{
    conversationId: string;
    messageId: string;
    message: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/chat${id ? `?id=${id}` : ""}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load chat.");
        if (!controller.signal.aborted) {
          setConversations(body.conversations);
          setTurns(body.turns);
          setLoaded(true);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load chat.");
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, revision]);
  const active = turns.some((turn) =>
    ["queued", "working"].includes(turn.runs[0]?.status),
  );
  function select(next: string | null) {
    setId(next);
    setTurns([]);
    setMessage("");
    setError("");
    setLoaded(false);
    pending.current = null;
  }
  async function send() {
    if (busy || active || !message.trim()) return;
    const payload =
      pending.current?.message === message.trim()
        ? pending.current
        : {
            conversationId: id ?? crypto.randomUUID(),
            messageId: crypto.randomUUID(),
            message: message.trim(),
          };
    pending.current = payload;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not send message.");
      setId(payload.conversationId);
      setMessage("");
      pending.current = null;
      setTurns((previous) =>
        previous.some((turn) => turn.id === body.messageId)
          ? previous
          : [
              ...previous,
              {
                id: body.messageId,
                chat_message: payload.message,
                runs: [
                  { status: "queued", result_markdown: null, error: null },
                ],
              },
            ],
      );
      setRevision((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.shell}>
      <header>
        <Link href="/tasks">Relay</Link>
        <nav aria-label="Main navigation">
          <Link href="/my-work">My Work</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/schedules">Schedules</Link>
          <Link href="/chat" aria-current="page">
            Chat
          </Link>
        </nav>
      </header>
      <h1>Chat</h1>
      <p>Think out loud, connect the dots, or ask what needs your attention.</p>
      <p className={styles.note}>
        Replies use your local worker, recent Relay tasks and open actions.
        Available connections depend on that worker; the API backend only sees
        supplied context. Chat requests observation and advice only. It does not
        continuously monitor your connections.
      </p>
      <div className={styles.layout}>
        <aside aria-label="Conversations">
          <button disabled={busy} onClick={() => select(null)}>
            New conversation
          </button>
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              disabled={busy}
              aria-pressed={conversation.id === id}
              onClick={() => select(conversation.id)}
            >
              {conversation.title}
            </button>
          ))}
          <small>Showing the latest 100 conversations.</small>
        </aside>
        <section aria-label="Conversation">
          {!loaded && <p role="status">Loading conversation…</p>}
          {loaded && !turns.length && (
            <p>
              Try “What should I prepare for this week?” or “Look for things I
              may have missed in HEY and my calendar.”
            </p>
          )}
          <div className={styles.messages} aria-live="polite">
            {turns.map((turn) => {
              const run = turn.runs[0];
              return (
                <article key={turn.id}>
                  <div className={styles.user}>
                    <strong>You</strong>
                    <p>{turn.chat_message}</p>
                  </div>
                  <div className={styles.reply}>
                    <strong>Relay</strong>
                    {run?.result_markdown ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {run.result_markdown}
                      </ReactMarkdown>
                    ) : (
                      <p role="status">
                        {run?.status === "failed"
                          ? `Reply failed: ${run.error || "Worker error"}. You can send your message again.`
                          : run?.status === "cancelled"
                            ? "Reply cancelled. You can send another message."
                            : run?.status === "working"
                              ? "Reading context and preparing a reply…"
                              : "Waiting for your worker. Replies will resume when it is online."}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {turns.length >= 100 && (
            <p className={styles.note}>
              Showing the latest 100 messages. Replies use the latest 12 turns.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="chat-message">Message</label>
            <textarea
              id="chat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={4000}
              rows={4}
              disabled={busy}
              placeholder="Ask about anything…"
            />
            <button
              disabled={!loaded || busy || active || !message.trim()}
              type="submit"
            >
              {busy ? "Sending…" : active ? "Waiting for reply…" : "Send"}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
