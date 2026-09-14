import { NextResponse } from "next/server";
import { requireUser, ApiError, apiErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushPayload, sendPush } from "@/lib/push";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const { endpoint } = await request.json();
    if (typeof endpoint !== "string") throw new ApiError("Endpoint required.");
    const { data, error } = await createAdminClient()
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", user.id)
      .eq("endpoint", endpoint)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError("Enable notifications first.", 404);
    try {
      await sendPush(
        {
          endpoint: data.endpoint,
          keys: { p256dh: data.p256dh, auth: data.auth },
        },
        pushPayload("test"),
      );
    } catch {
      throw new ApiError(
        "Test delivery failed. Try disabling and enabling notifications again.",
        502,
      );
    }
    return NextResponse.json({ sent: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
