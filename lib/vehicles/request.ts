import { ApiError } from "@/lib/api-error";

export async function readVehicleJson(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Vehicle request required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes)
        throw new ApiError("Vehicle request is too large.", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new ApiError("Vehicle request must be a JSON object.");
  }
}
