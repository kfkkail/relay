import { NextResponse } from "next/server";
import { requireUser, ApiError, apiErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushConfig, validateSubscription } from "@/lib/push";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    pushConfig();
    const subscription = validateSubscription(await request.json());
    const db = createAdminClient();
    const { data: existing, error: lookupError } = await db
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.user_id !== user.id)
      throw new ApiError(
        "Disable notifications in the previous account first.",
        409,
      );
    const { error } = await db.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        ...subscription.keys,
      },
      { onConflict: "endpoint", ignoreDuplicates: true },
    );
    if (error) throw error;
    return NextResponse.json({ enabled: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await requireUser();
    const { endpoint } = await request.json();
    if (typeof endpoint !== "string") throw new ApiError("Endpoint required.");
    const db = createAdminClient();
    const { data: subscription, error: lookupError } = await db
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .eq("endpoint", endpoint)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (subscription) {
      const { error: cancelError } = await db
        .from("push_deliveries")
        .delete()
        .eq("subscription_id", subscription.id)
        .is("finished_at", null);
      if (cancelError) throw cancelError;
    }
    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
    if (error) throw error;
    return NextResponse.json({ enabled: false });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
