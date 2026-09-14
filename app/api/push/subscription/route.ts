import { cookies } from "next/headers";
import { PUSH_DEVICE_COOKIE, pushCookieOptions } from "@/lib/push-cookie";
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
    const { data: saved, error: savedError } = await db
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", subscription.endpoint)
      .eq("user_id", user.id)
      .maybeSingle();
    if (savedError) throw savedError;
    if (!saved)
      throw new ApiError(
        "Subscription registration could not be verified.",
        409,
      );
    const response = NextResponse.json({ enabled: true });
    response.cookies.set(PUSH_DEVICE_COOKIE, saved.id, pushCookieOptions);
    return response;
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
      const { error } = await db.rpc("remove_push_subscription", {
        p_user_id: user.id,
        p_subscription_id: subscription.id,
      });
      if (error) throw error;
    }
    const response = NextResponse.json({ enabled: false });
    if ((await cookies()).get(PUSH_DEVICE_COOKIE)?.value === subscription?.id)
      response.cookies.delete(PUSH_DEVICE_COOKIE);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
