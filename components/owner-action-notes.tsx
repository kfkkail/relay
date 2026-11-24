"use client";

import { ImagePlus, Link2 } from "lucide-react";
import { useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type DraftNoteImage,
  splitNoteImages,
  noteImageLimit,
  noteImagePrefix,
  noteImageTypes,
} from "@/lib/owner-action-note-media";

export function OwnerActionNotesEditor({
  id,
  notes,
  onChange,
  images,
  onImagesChange,
  disabled,
}: {
  id: string;
  notes: string;
  onChange: (notes: string) => void;
  images: DraftNoteImage[];
  onImagesChange: (images: DraftNoteImage[]) => void;
  disabled: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [addingLink, setAddingLink] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const { text, images: attached } = splitNoteImages(notes);
  const references = attached.map(({ markup }) => markup);

  function combineNotes(value: string, imageReferences = references) {
    return [value, ...imageReferences].filter(Boolean).join("\n\n");
  }

  function addLink() {
    let link: URL;
    try {
      link = new URL(url.trim());
      if (!["http:", "https:"].includes(link.protocol)) throw new Error();
    } catch {
      setError("Enter a full link starting with https:// or http://.");
      return;
    }
    const field = textarea.current!;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const linkLabel = (label.trim() || link.href).replace(/[\\[\]]/g, "\\$&");
    const next = combineNotes(
      text.slice(0, start) + `[${linkLabel}](<${link.href}>)` + text.slice(end),
    );
    if (next.length > 20000) {
      setError("Notes must be 20,000 characters or fewer.");
      return;
    }
    onChange(next);
    setAddingLink(false);
    setError("");
    textarea.current?.focus();
  }

  function addImages(files: File[]) {
    if (!files.length) return;
    const ids = new Set(attached.map(({ id }) => id));
    const pending = images.filter(({ id }) => ids.has(id));
    if (
      files.some((file) => !noteImageTypes.includes(file.type) || !file.size)
    ) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (
      pending.length + files.length > 10 ||
      [...pending.map(({ file }) => file), ...files].reduce(
        (sum, file) => sum + file.size,
        0,
      ) > noteImageLimit
    ) {
      setError("Add up to 10 images totaling 3 MB or less per save.");
      return;
    }
    const added = files.map((file) => ({ id: crypto.randomUUID(), file }));
    const newReferences = added.map(({ id, file }) => {
      const name = file.name
        .replace(/[\r\n]/g, " ")
        .replace(/[\\[\]]/g, "\\$&");
      return `![${name}](${noteImagePrefix}${id})`;
    });
    const next = combineNotes(text, [...references, ...newReferences]);
    if (next.length > 20000) {
      setError("Notes must be 20,000 characters or fewer.");
      return;
    }
    onImagesChange([...pending, ...added]);
    onChange(next);
    setError("");
  }

  return (
    <div className="owner-note-editor">
      <label htmlFor={id}>Notes (optional)</label>
      <textarea
        id={id}
        ref={textarea}
        value={text}
        onChange={(event) => {
          const next = combineNotes(event.target.value);
          if (next.length <= 20000) onChange(next);
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (!disabled && files.length) {
            event.preventDefault();
            addImages(files);
          }
        }}
        maxLength={20000}
        rows={5}
        disabled={disabled}
      />
      <div className="owner-note-tools">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          aria-expanded={addingLink}
          onClick={() => {
            const field = textarea.current!;
            setLabel(text.slice(field.selectionStart, field.selectionEnd));
            setUrl("");
            setError("");
            setAddingLink(!addingLink);
          }}
        >
          <Link2 size={16} /> Add link
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          <ImagePlus size={16} /> Add images
        </button>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          disabled={disabled}
          accept={noteImageTypes.join(",")}
          onChange={(event) => {
            addImages(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {addingLink && (
        <div className="owner-note-link">
          <label htmlFor={`${id}-url`}>Link URL</label>
          <input
            id={`${id}-url`}
            type="text"
            inputMode="url"
            value={url}
            placeholder="https://"
            disabled={disabled}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              }
            }}
          />
          <label htmlFor={`${id}-label`}>Link text (optional)</label>
          <input
            id={`${id}-label`}
            value={label}
            disabled={disabled}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              }
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={addLink}
          >
            Insert link
          </button>
        </div>
      )}
      {attached.length > 0 && (
        <ul className="owner-note-files">
          {attached.map(({ id: imageId, name }) => (
            <li key={imageId}>
              <span>{name || "Image"}</span>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                aria-label={`Remove ${name || "image"}`}
                onClick={() => {
                  onChange(
                    combineNotes(
                      text,
                      attached
                        .filter(({ id }) => id !== imageId)
                        .map(({ markup }) => markup),
                    ),
                  );
                  onImagesChange(images.filter(({ id }) => id !== imageId));
                  setError("");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function OwnerActionNotes({
  notes,
  actionId,
  compact = false,
}: {
  notes: string;
  actionId: string;
  compact?: boolean;
}) {
  const { text, images } = splitNoteImages(notes);
  return (
    <div className={`markdown owner-note-content${compact ? " compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) =>
          key === "src" ? "" : defaultUrlTransform(url)
        }
        components={{ img: ({ alt }) => <span>{alt || "Image"}</span> }}
      >
        {text}
      </ReactMarkdown>
      {images.length > 0 &&
        (compact ? (
          <span>
            {images.length} {images.length === 1 ? "image" : "images"}
          </span>
        ) : (
          <div className="owner-note-gallery">
            {images.map(({ id, name }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={id}
                src={`/api/owner-actions/${actionId}/note-images/${id}`}
                alt={name || "Action image"}
                loading="lazy"
              />
            ))}
          </div>
        ))}
    </div>
  );
}
