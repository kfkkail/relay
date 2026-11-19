import { CalendarPlus, ChevronRight } from "lucide-react";

// Let result Markdown link to attached documents by filename, e.g.
// [Add to calendar](dentist.ics). The agent only knows the workspace-relative
// path, so we resolve the basename to the uploaded document's authenticated
// URL: calendar files download directly (a tap opens the OS calendar app),
// everything else opens the in-app viewer.
export function documentLinkComponents(
  taskId: string,
  documents: import("@/lib/types").ResultDocument[],
): import("react-markdown").Components {
  const byFilename = new Map(
    (documents ?? []).map((document) => [
      document.display_filename.toLowerCase(),
      document,
    ]),
  );
  return {
    a({ href, children }) {
      const document = href ? byFilename.get(linkFilename(href)) : undefined;
      if (document) {
        return document.mime_type === "text/calendar" ? (
          <a
            href={`/api/tasks/${taskId}/documents/${document.id}`}
            download={document.display_filename}
          >
            {children}
          </a>
        ) : (
          <a href={`/tasks/${taskId}/documents/${document.id}`}>{children}</a>
        );
      }
      if (href && /^(https?:|mailto:)/i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      // Unresolved relative links would navigate inside the app; render the
      // link text as plain content instead of a dead link.
      return <>{children}</>;
    },
  };
}

function linkFilename(href: string) {
  const path = href.split(/[?#]/)[0];
  const name = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

export function ResultDocuments({
  taskId,
  documents,
}: {
  taskId: string;
  documents: import("@/lib/types").ResultDocument[];
}) {
  if (!documents?.length) return null;
  return (
    <div className="artifact-list">
      <p className="eyebrow">Documents</p>
      {documents.map((document) => {
        const isCalendar = document.mime_type === "text/calendar";
        // Calendar files download directly so a tap hands the .ics to the OS
        // calendar app instead of opening the in-app text preview.
        return isCalendar ? (
          <a
            key={document.id}
            href={`/api/tasks/${taskId}/documents/${document.id}`}
            download={document.display_filename}
          >
            <span>calendar · {formatBytes(document.byte_size)}</span>
            <strong>{document.display_filename}</strong>
            <CalendarPlus size={17} />
          </a>
        ) : (
          <a
            key={document.id}
            href={`/tasks/${taskId}/documents/${document.id}`}
          >
            <span>
              {document.mime_type.split("/").at(-1)} ·{" "}
              {formatBytes(document.byte_size)}
            </span>
            <strong>{document.display_filename}</strong>
            <ChevronRight size={17} />
          </a>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
