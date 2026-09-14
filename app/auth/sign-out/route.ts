import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUSH_DEVICE_COOKIE } from "@/lib/push-cookie";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const deviceId = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value;
    if (user && deviceId) {
      const { error } = await createAdminClient().rpc(
        "remove_push_subscription",
        { p_user_id: user.id, p_subscription_id: deviceId },
      );
      if (error) throw error;
    }
    // Preserve sessions and notification subscriptions on other devices.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    const response = NextResponse.redirect(new URL("/", request.url), 303);
    response.cookies.delete(PUSH_DEVICE_COOKIE);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not safely sign out. Please try again." },
      { status: 503 },
    );
  }
}
