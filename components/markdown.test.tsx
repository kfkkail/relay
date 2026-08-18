import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

describe("result Markdown", () => {
  it("turns a bare GitHub pull request URL into a link", () => {
    const url = "https://github.com/kfkkail/relay/pull/23";
    const markup = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{`Created ${url}`}</ReactMarkdown>,
    );

    expect(markup).toContain(`<a href="${url}">${url}</a>`);
  });
});
