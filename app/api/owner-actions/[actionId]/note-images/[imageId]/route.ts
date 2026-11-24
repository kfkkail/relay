import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import {
  noteImageIdPattern,
  noteImageTypes,
} from "@/lib/owner-action-note-media";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ actionId: string; imageId: string }> },
) {
  try {
    const { supabase } = await requireUser();
    const { actionId, imageId } = await params;
    if (!noteImageIdPattern.test(actionId) || !noteImageIdPattern.test(imageId))
      throw new ApiError("Image not found.", 404);
    const { data: image, error } = await supabase.rpc(
      "read_owner_action_note_image",
      {
        p_action_id: actionId,
        p_image_id: imageId,
      },
    );
    if (
      error ||
      !image ||
      !noteImageTypes.includes(image.mimeType) ||
      typeof image.data !== "string"
    )
      throw new ApiError("Image not found.", 404);
    return new Response(new Uint8Array(Buffer.from(image.data, "base64")), {
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
