import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { expect, it } from "vitest";
import type { ResultDocument } from "@/lib/types";
import { documentLinkComponents, ResultDocuments } from "./result-documents";

const documents: ResultDocument[] = [
  {
    id: "calendar",
    display_filename: "visit.ics",
    mime_type: "text/calendar",
    byte_size: 200,
    description: null,
  },
  {
    id: "report",
    display_filename: "report.md",
    mime_type: "text/markdown",
    byte_size: 400,
    description: null,
  },
];

it("resolves chat and task document links to authenticated downloads and viewers", () => {
  const html = renderToStaticMarkup(
    <ReactMarkdown components={documentLinkComponents("turn", documents)}>
      {
        "[Add to calendar](output/visit.ics) [Report](report.md) [Missing](missing.md) [Source](https://example.com)"
      }
    </ReactMarkdown>,
  );
  expect(html).toContain(
    'href="/api/tasks/turn/documents/calendar" download="visit.ics"',
  );
  expect(html).toContain('href="/tasks/turn/documents/report"');
  expect(html).not.toContain('href="missing.md"');
  expect(html).toContain('href="https://example.com"');
});

it("lists generated documents even when a reply does not include inline links", () => {
  const html = renderToStaticMarkup(
    <ResultDocuments taskId="turn" documents={documents} />,
  );
  expect(html).toContain('href="/api/tasks/turn/documents/calendar"');
  expect(html).toContain('href="/tasks/turn/documents/report"');
  expect(
    renderToStaticMarkup(<ResultDocuments taskId="turn" documents={[]} />),
  ).toBe("");
});
