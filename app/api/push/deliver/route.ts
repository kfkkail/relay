import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushConfig, pushPayload, pushStatus, sendPush } from "@/lib/push";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    pushConfig();
    const db = createAdminClient();
    const { data, error } = await db.rpc("claim_push_deliveries");
    if (error) throw error;
    await Promise.all(
      (data ?? []).map(
        async (delivery: {
          id: string;
          subscription_id: string;
          task_id: string;
          outcome: string;
          attempts: number;
        }) => {
          const { data: subscription, error: lookupError } = await db
            .from("push_subscriptions")
            .select("endpoint,p256dh,auth")
            .eq("id", delivery.subscription_id)
            .maybeSingle();
          if (lookupError) throw lookupError;
          if (!subscription) return;
          let status = 201;
          try {
            await sendPush(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              pushPayload(delivery.outcome, delivery.task_id, delivery.id),
            );
          } catch (error) {
            status = pushStatus(error);
          }
          if (status === 404 || status === 410) {
            const { error } = await db
              .from("push_subscriptions")
              .delete()
              .eq("id", delivery.subscription_id);
            if (error) throw error;
            return;
          }
          const done =
            (status >= 200 && status < 300) || delivery.attempts >= 6;
          const { error: updateError } = await db
            .from("push_deliveries")
            .update(
              done
                ? { finished_at: new Date().toISOString() }
                : {
                    available_at: new Date(
                      Date.now() +
                        Math.min(3600, 60 * 2 ** delivery.attempts) * 1000,
                    ).toISOString(),
                  },
            )
            .eq("id", delivery.id)
            .eq("attempts", delivery.attempts);
          if (updateError) throw updateError;
        },
      ),
    );
    const { error: cleanupError } = await db
      .from("push_deliveries")
      .delete()
      .lt("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    if (cleanupError) throw cleanupError;
    return NextResponse.json({ processed: data?.length ?? 0 });
  } catch {
    // Provider errors can contain subscription credentials; never log them.
    return NextResponse.json(
      { error: "Push delivery unavailable." },
      { status: 503 },
    );
  }
}
