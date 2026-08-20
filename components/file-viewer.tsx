import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function FileViewerShell({
  title,
  detail,
  downloadUrl,
  children,
}: {
  title: string;
  detail: string;
  downloadUrl: string;
  children: React.ReactNode;
}) {
  return (
    <main className="file-viewer">
      <header className="file-viewer-header">
        <Link className="file-viewer-back" href="/">
          <ArrowLeft size={19} />
          <span>Back to Relay</span>
        </Link>
        <div className="file-viewer-title">
          <p>{detail}</p>
          <h1>{title}</h1>
        </div>
        <a className="file-viewer-download" href={downloadUrl} download>
          <Download size={18} />
          <span>Download</span>
        </a>
      </header>
      <section className="file-viewer-content">{children}</section>
    </main>
  );
}

export function DocumentPreview({
  mimeType,
  content,
  sourceUrl,
  title,
}: {
  mimeType: string;
  content: string | null;
  sourceUrl: string;
  title: string;
}) {
  if (mimeType === "text/markdown" && content !== null) {
    return (
      <article className="markdown file-viewer-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    );
  }
  if (mimeType === "application/pdf") {
    return (
      <iframe
        className="file-viewer-pdf"
        src={`${sourceUrl}?inline=1`}
        title={title}
      />
    );
  }
  if (content !== null) {
    return <pre className="file-viewer-text">{content}</pre>;
  }
  return (
    <p className="file-viewer-error">
      A preview is not available for this file.
    </p>
  );
}
