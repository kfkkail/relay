"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  SquarePen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RelayHeader } from "@/components/relay-header";
import {
  documentLinkComponents,
  ResultDocuments,
} from "@/components/result-documents";
import type { ResultDocument } from "@/lib/types";
import styles from "./chat.module.css";

type Conversation = { id: string; title: string };
type Turn = {
  id: string;
  chat_message: string;
  runs: {
    status: string;
    result_markdown: string | null;
    error: string | null;
    result_documents?: ResultDocument[];
  }[];
};

export function Chat({
  initialId = null,
  initialNew = false,
  userEmail,
}: {
  initialId?: string | null;
  initialNew?: boolean;
  userEmail: string;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [id, setId] = useState<string | null>(initialId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const conversationOpen = Boolean(initialId || initialNew);
  const title =
    conversations.find((conversation) => conversation.id === id)?.title ??
    (id ? "Conversation" : "New conversation");
  const shell = useRef<HTMLElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const refreshVersion = useRef(0);
  // Reuse IDs on network failure so retrying cannot enqueue a duplicate turn.
  const pending = useRef<{
    conversationId: string;
    messageId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    // iOS's on-screen keyboard shrinks the visual viewport, not 100dvh.
    const viewport = window.visualViewport;
    if (!viewport) return;
    function resize() {
      if (!viewport || viewport.scale !== 1) return;
      shell.current?.style.setProperty("--chat-height", `${viewport.height}px`);
      shell.current?.style.setProperty("--chat-top", `${viewport.offsetTop}px`);
    }
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      const version = refreshVersion.current;
      try {
        const response = await fetch(`/api/chat${id ? `?id=${id}` : ""}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load chat.");
        if (!controller.signal.aborted && version === refreshVersion.current) {
          setConversations(body.conversations);
          setTurns(body.turns);
          setLoaded(true);
        }
      } catch (e) {
        if (!controller.signal.aborted && version === refreshVersion.current)
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

  useEffect(() => {
    if (followLatest.current && messages.current) {
      messages.current.scrollTop = messages.current.scrollHeight;
    }
  }, [turns]);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [message]);

  const active = turns.some((turn) =>
    ["queued", "working"].includes(turn.runs[0]?.status),
  );

  async function send() {
    if (!loaded || busy || active || !message.trim()) return;
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
    refreshVersion.current++;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not send message.");
      // Ignore a poll started before this submission completed.
      refreshVersion.current++;
      followLatest.current = true;
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
      if (!id) router.replace(`/chat?id=${payload.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message.");
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    router.push("/chat?new=1");
    if (!id) {
      setMessage("");
      setError("");
      pending.current = null;
      textarea.current?.focus();
    }
  }

  if (!conversationOpen) {
    return (
      <main className={styles.shell} ref={shell}>
        <RelayHeader userEmail={userEmail} active="chat" />
        <section className={styles.index} aria-labelledby="chat-title">
          <div className={styles.indexContent}>
            <div className={styles.heading}>
              <div>
                <p className="eyebrow">Conversations</p>
                <h1 id="chat-title">Chat</h1>
                <p>Think out loud. Pick up where you left off.</p>
              </div>
              <button
                className="new-button"
                onClick={newConversation}
                aria-label="New conversation"
              >
                <Plus size={18} aria-hidden="true" />
                <span>New conversation</span>
              </button>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {!loaded && !error && (
              <p className={styles.status} role="status">
                <LoaderCircle
                  size={18}
                  className={styles.spinner}
                  aria-hidden="true"
                />
                Loading conversations…
              </p>
            )}
            {loaded && !conversations.length && (
              <div className={styles.empty}>
                <span className="empty-orbit">
                  <MessageCircle size={28} aria-hidden="true" />
                </span>
                <h2>A little room to think.</h2>
                <p>
                  Ask a question, work through an idea, or figure out what needs
                  your attention.
                </p>
                <button className="new-button" onClick={newConversation}>
                  <Plus size={18} aria-hidden="true" />
                  Start a conversation
                </button>
              </div>
            )}
            <div className={styles.conversationList} aria-label="Conversations">
              {conversations.map((conversation) => (
                <button
                  className={styles.conversationCard}
                  key={conversation.id}
                  onClick={() => router.push(`/chat?id=${conversation.id}`)}
                >
                  <MessageCircle size={22} aria-hidden="true" />
                  <span>{conversation.title}</span>
                </button>
              ))}
            </div>
            {conversations.length >= 100 && (
              <p className={styles.note}>
                Showing the latest 100 conversations.
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell} ref={shell}>
      <header className={styles.conversationHeader}>
        <button
          className="back-button"
          disabled={busy}
          onClick={() => router.push("/chat")}
          aria-label="Back to conversations"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          Chat
        </button>
        <div className={styles.conversationTitle}>
          <p>Relay</p>
          <h1 title={title}>{title}</h1>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={newConversation}
          aria-label="New conversation"
        >
          <SquarePen size={20} aria-hidden="true" />
        </button>
      </header>
      <section className={styles.conversation} aria-label="Conversation">
        <div
          className={styles.messages}
          ref={messages}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
          }}
        >
          {!loaded && (
            <p className={styles.status} role="status">
              <LoaderCircle
                size={18}
                className={styles.spinner}
                aria-hidden="true"
              />
              Loading conversation…
            </p>
          )}
          {loaded && !turns.length && (
            <div className={styles.empty}>
              <span className="empty-orbit">
                <MessageCircle size={28} aria-hidden="true" />
              </span>
              <h2>What’s on your mind?</h2>
              <p>Make space for a question, an idea, or a fresh perspective.</p>
              <div className={styles.suggestions}>
                {[
                  "What should I prepare for this week?",
                  "Help me think through a decision.",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    disabled={busy}
                    onClick={() => {
                      setMessage(suggestion);
                      textarea.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={styles.thread} aria-live="polite">
            {turns.map((turn) => {
              const run = turn.runs[0];
              return (
                <article key={turn.id} className={styles.turn}>
                  <div className={styles.user}>
                    <strong className="sr-only">You</strong>
                    <p>{turn.chat_message}</p>
                  </div>
                  <div className={styles.reply}>
                    <div className={styles.replyLabel}>
                      <span className="brand-mark" aria-hidden="true">
                        R
                      </span>
                      <strong>Relay</strong>
                    </div>
                    {run?.result_markdown ? (
                      <div className={`markdown ${styles.markdown}`}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={documentLinkComponents(
                            turn.id,
                            run.result_documents ?? [],
                          )}
                        >
                          {run.result_markdown}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className={styles.status} role="status">
                        {run?.status === "working" ? (
                          <LoaderCircle
                            size={18}
                            className={styles.spinner}
                            aria-hidden="true"
                          />
                        ) : run?.status === "queued" ? (
                          <Clock3 size={18} aria-hidden="true" />
                        ) : null}
                        {run?.status === "failed"
                          ? `Reply failed: ${run.error || "Worker error"}. You can send your message again.`
                          : run?.status === "cancelled"
                            ? "Reply cancelled. You can send another message."
                            : run?.status === "working"
                              ? "Reading context and preparing a reply…"
                              : "Waiting for your worker. Replies will resume when it is online."}
                      </p>
                    )}
                    <ResultDocuments
                      taskId={turn.id}
                      documents={run?.result_documents ?? []}
                    />
                  </div>
                </article>
              );
            })}
            {turns.length >= 100 && (
              <p className={styles.note}>
                Showing the latest 100 messages. Replies use the latest 12
                turns.
              </p>
            )}
          </div>
        </div>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className={styles.composerContent}>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <label htmlFor="chat-message" className="sr-only">
              Message
            </label>
            <div className={styles.input}>
              <textarea
                ref={textarea}
                id="chat-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                maxLength={4000}
                rows={1}
                disabled={busy}
                placeholder="Message Relay…"
              />
              <button
                className="primary-button compact"
                disabled={!loaded || busy || active || !message.trim()}
                type="submit"
                aria-label={
                  busy
                    ? "Sending message"
                    : active
                      ? "Waiting for reply"
                      : "Send message"
                }
              >
                {busy || active ? (
                  <LoaderCircle
                    size={18}
                    className={styles.spinner}
                    aria-hidden="true"
                  />
                ) : (
                  <Send size={18} aria-hidden="true" />
                )}
                <span>{busy ? "Sending…" : active ? "Waiting…" : "Send"}</span>
              </button>
            </div>
            <details className={styles.replyInfo}>
              <summary>How replies work</summary>
              <p>
                Replies use your local worker, recent Relay tasks and open
                actions. Available connections depend on that worker; the API
                backend only sees supplied context. Chat can carry out the same
                work as tasks, including requested actions and documents, using
                your worker’s permissions. It does not continuously monitor your
                connections.
              </p>
            </details>
          </div>
        </form>
      </section>
    </main>
  );
}
