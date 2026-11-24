import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerActionNotes } from "./owner-action-notes";
import { splitNoteImages } from "@/lib/owner-action-note-media";

const imageId = "e5eab890-edfd-4530-86f5-817f59418882";
const anotherId = "05eab890-edfd-4530-86f5-817f59418882";
const image = `![Receipt \\[front\\].png](relay-note-image/${imageId})`;
const anotherImage = `![Back.png](relay-note-image/${anotherId})`;

describe("owner action notes", () => {
  it("keeps typed whitespace and extracts consecutive attachment references", () => {
    const text = "Notes with a trailing newline\n";
    expect(splitNoteImages(`${text}\n\n${image}\n\n${anotherImage}`)).toEqual({
      text,
      images: [
        { id: imageId, name: "Receipt [front].png", markup: image },
        { id: anotherId, name: "Back.png", markup: anotherImage },
      ],
    });
  });

  it("renders pasted URLs and loads only the action's private images", () => {
    const notes = `Details https://example.com/item\n\n![Remote](https://example.com/pixel.png)\n\n${image}`;
    const markup = renderToStaticMarkup(
      <OwnerActionNotes notes={notes} actionId="action-1" />,
    );
    expect(markup).toContain('href="https://example.com/item"');
    expect(markup).toContain(
      `src="/api/owner-actions/action-1/note-images/${imageId}"`,
    );
    expect(markup).not.toContain("pixel.png");
  });

  it("shows the attachment count without loading image bytes in the list", () => {
    const markup = renderToStaticMarkup(
      <OwnerActionNotes notes={image} actionId="action-1" compact />,
    );
    expect(markup).toContain("1 image");
    expect(markup).not.toContain("<img");
  });
});
