// Shared by worker and server-side VIN decoding; no filesystem/cache imports.
export async function boundedText(response, maxBytes, onBytes = () => {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      onBytes(value.byteLength);
      if (bytes > maxBytes) throw new Error("seller_page_too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
