export const noteImagePrefix = "relay-note-image/";
export const noteImageLimit = 3 * 1024 * 1024;
export const noteImageTypes = ["image/jpeg", "image/png", "image/webp"];
export const noteImageIdPattern =
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export type DraftNoteImage = { id: string; file: File };

export function splitNoteImages(notes: string) {
  const images: { id: string; name: string; markup: string }[] = [];
  const text = notes.replace(
    /(?:^|\n\n)(!\[((?:\\.|[^\]\\\r\n])*)\]\(relay-note-image\/([a-f0-9-]{36})\))(?=\n\n|$)/g,
    (match, markup: string, name: string, id: string) => {
      if (!noteImageIdPattern.test(id)) return match;
      images.push({ id, name: name.replace(/\\(.)/g, "$1"), markup });
      return "";
    },
  );
  return { text, images };
}

export function noteImageIds(notes: string) {
  return splitNoteImages(notes).images.map(({ id }) => id);
}

export async function encodeDraftNoteImages(
  notes: string,
  images: DraftNoteImage[],
) {
  const ids = new Set(noteImageIds(notes));
  return Promise.all(
    images
      .filter(({ id }) => ids.has(id))
      .map(async ({ id, file }) => {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () =>
            reject(new Error("Could not read the selected image."));
          reader.readAsDataURL(file);
        });
        return { id, mimeType: file.type, data };
      }),
  );
}
