"use client";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  SquarePen,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RelayHeader } from "@/components/relay-header";
import {
  documentLinkComponents,
  ResultDocuments,
} from "@/components/result-documents";
import {
  ATTACHMENT_BUCKET,
  attachmentMimeTypes,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachment-config";
import { createClient } from "@/lib/supabase/client";
import type { ResultDocument } from "@/lib/types";
import styles from "./chat.module.css";

const KEYBOARD_PULL_SLOP = 12;
const KEYBOARD_DISMISS_DISTANCE = 100;

type Conversation = { id: string; title: string };
type ChatAttachment = { id: string; file_name: string };
type Turn = {
  id: string;
  chat_message: string;
  task_attachments?: ChatAttachment[];
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
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
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
  const thread = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const keyboardPull = useRef<{
    x: number;
    y: number;
    tracking: boolean;
  } | null>(null);
  const followLatest = useRef(true);
  const refreshVersion = useRef(0);
  // Reuse IDs on network failure so retrying cannot enqueue a duplicate turn.
  const pending = useRef<{
    conversationId: string;
    messageId: string;
    message: string;
    image: File | null;
  } | null>(null);

  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const { style } = element;
    const viewport = window.visualViewport;
    let frame = 0;

    function syncViewport() {
      frame = 0;
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      style.setProperty(
        "--chat-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      style.setProperty("--chat-top", `${viewport?.offsetTop ?? 0}px`);
    }

    function scheduleSync() {
      if (!frame) frame = window.requestAnimationFrame(syncViewport);
    }

    syncViewport();
    viewport?.addEventListener("resize", scheduleSync);
    viewport?.addEventListener("scroll", scheduleSync);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", scheduleSync);
      viewport?.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync);
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
    const scroller = messages.current;
    const content = thread.current;
    if (!scroller || !content) return;
    // Follow layout changes from new replies, the composer and the keyboard.
    const observer = new ResizeObserver(() => {
      if (followLatest.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversationOpen]);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [message]);

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function selectImage(file: File) {
    if (!attachmentMimeTypes.some((mimeType) => mimeType === file.type)) {
      setError("Images must be JPEG, PNG, or WebP.");
    } else if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
      setError("Choose a non-empty image up to 10 MB.");
    } else {
      setImage(file);
      setPreview(URL.createObjectURL(file));
      setError("");
    }
  }

  const active = turns.some((turn) =>
    ["queued", "working"].includes(turn.runs[0]?.status),
  );

  async function send() {
    if (!loaded || busy || active || (!message.trim() && !image)) return;
    const text = message.trim() || "Describe this image.";
    const payload =
      pending.current?.message === text && pending.current.image === image
        ? pending.current
        : {
            conversationId: id ?? crypto.randomUUID(),
            messageId: crypto.randomUUID(),
            message: text,
            image,
          };
    pending.current = payload;
    setBusy(true);
    setError("");
    refreshVersion.current++;
    try {
      const { image, ...messageFields } = payload;
      const body = await postJson("/api/chat", {
        ...messageFields,
        ...(image ? { image: await uploadChatImage(image) } : {}),
      });
      // Ignore a poll started before this submission completed.
      refreshVersion.current++;
      followLatest.current = true;
      setId(payload.conversationId);
      setMessage("");
      setImage(null);
      setPreview("");
      pending.current = null;
      setTurns((previous) =>
        previous.some((turn) => turn.id === body.messageId)
          ? previous
          : [
              ...previous,
              {
                id: body.messageId,
                chat_message: payload.message,
                task_attachments: body.attachment ? [body.attachment] : [],
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
      setImage(null);
      setPreview("");
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
                <h1 id="chat-title">Chats</h1>
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

  function resetKeyboardPull() {
    keyboardPull.current = null;
    composer.current?.removeAttribute("data-keyboard-pull");
    composer.current?.style.removeProperty("--keyboard-pull");
  }

  return (
    <main className={styles.shell} ref={shell}>
      <header className={styles.conversationHeader}>
        <button
          className="back-button"
          disabled={busy}
          onClick={() => router.push("/chat")}
          aria-label="Back to Chats"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          Chats
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
          onTouchStart={(event) => {
            resetKeyboardPull();
            const viewport = window.visualViewport;
            if (
              event.touches.length !== 1 ||
              textarea.current !== document.activeElement ||
              !viewport ||
              Math.abs(viewport.scale - 1) > 0.01 ||
              document.documentElement.clientHeight - viewport.height < 100
            ) {
              return;
            }
            const touch = event.touches[0];
            keyboardPull.current = {
              x: touch.screenX,
              y: touch.screenY,
              tracking: false,
            };
          }}
          onTouchMove={(event) => {
            const start = keyboardPull.current;
            if (!start) return;
            if (event.touches.length !== 1) {
              resetKeyboardPull();
              return;
            }
            const touch = event.touches[0];
            const downward = touch.screenY - start.y;
            const sideways = Math.abs(touch.screenX - start.x);
            if (!start.tracking) {
              if (Math.max(Math.abs(downward), sideways) < KEYBOARD_PULL_SLOP)
                return;
              if (downward <= sideways * 1.5) {
                resetKeyboardPull();
                return;
              }
              start.tracking = true;
              composer.current?.setAttribute("data-keyboard-pull", "");
            }
            const offset = Math.min(48, Math.max(0, downward) * 0.4);
            composer.current?.style.setProperty(
              "--keyboard-pull",
              `${offset}px`,
            );
          }}
          onTouchEnd={(event) => {
            const start = keyboardPull.current;
            const touch = event.changedTouches[0];
            resetKeyboardPull();
            if (!start?.tracking || !touch || event.touches.length) return;
            const downward = touch.screenY - start.y;
            const sideways = Math.abs(touch.screenX - start.x);
            if (
              downward >= KEYBOARD_DISMISS_DISTANCE &&
              downward > sideways * 1.5
            )
              textarea.current?.blur();
          }}
          onTouchCancel={resetKeyboardPull}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <=
              2;
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
          <div className={styles.thread} ref={thread} aria-live="polite">
            {turns.map((turn) => {
              const run = turn.runs[0];
              return (
                <article key={turn.id} className={styles.turn}>
                  <div className={styles.user}>
                    <strong className="sr-only">You</strong>
                    {turn.task_attachments?.map((attachment) => {
                      const url = `/api/tasks/${turn.id}/attachments/${attachment.id}`;
                      return (
                        <a
                          key={attachment.id}
                          href={url}
                          className={styles.sentImage}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated image endpoint */}
                          <img src={url} alt={attachment.file_name} />
                        </a>
                      );
                    })}
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
                          ? `Reply failed: ${(run.error || "Worker error").trim().replace(/[.!?]+$/, "")}. You can send your message again.`
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
          ref={composer}
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
            {image && (
              <div className={styles.imagePreview}>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL
                  <img src={preview} alt="" />
                )}
                <span>{image.name}</span>
                <button
                  type="button"
                  className={styles.imageButton}
                  aria-label="Remove image"
                  disabled={busy}
                  onClick={() => {
                    setImage(null);
                    setPreview("");
                    setError("");
                  }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className={styles.input}>
              <input
                ref={imageInput}
                type="file"
                accept={attachmentMimeTypes.join(",")}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) selectImage(file);
                }}
              />
              <button
                type="button"
                className={styles.imageButton}
                aria-label="Attach image"
                disabled={busy}
                onClick={() => imageInput.current?.click()}
              >
                <Plus size={22} aria-hidden="true" />
              </button>
              <textarea
                ref={textarea}
                onBlur={resetKeyboardPull}
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
                disabled={
                  !loaded || busy || active || (!message.trim() && !image)
                }
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
          </div>
        </form>
      </section>
    </main>
  );
}

async function postJson(path: string, payload: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not send message.");
  return body;
}

async function uploadChatImage(file: File) {
  const metadata = {
    fileName: file.name,
    mimeType: file.type,
    byteSize: file.size,
  };
  const { uploadId, path, token } = await postJson(
    "/api/chat/uploads",
    metadata,
  );
  const { error } = await createClient()
    .storage.from(ATTACHMENT_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw error;
  return { ...metadata, uploadId };
}
