import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentPreview } from "./file-viewer";

describe("DocumentPreview", () => {
  it("renders Markdown as readable HTML", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        mimeType="text/markdown"
        content={"# Result\n\n- One\n- Two"}
        sourceUrl="/document"
        title="result.md"
      />,
    );

    expect(markup).toContain("<h1>Result</h1>");
    expect(markup).toContain("<li>One</li>");
  });

  it("embeds PDFs using the inline response", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        mimeType="application/pdf"
        content={null}
        sourceUrl="/document"
        title="report.pdf"
      />,
    );

    expect(markup).toContain('src="/document?inline=1"');
    expect(markup).toContain('title="report.pdf"');
  });
});
