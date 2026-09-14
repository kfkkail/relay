import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushConfig, pushPayload, pushStatus, sendPush } from "@/lib/push";

import { deliveryUpdate } from "@/lib/push-delivery";

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
          const { error: updateError } = await db
            .from("push_deliveries")
            .update(deliveryUpdate(status, delivery.attempts))
            .eq("id", delivery.id)
            .eq("attempts", delivery.attempts);
          if (updateError) throw updateError;
          if (status === 404 || status === 410) {
            // Preserve outcome rows while removing a dead endpoint.
            const { error } = await db
              .from("push_subscriptions")
              .delete()
              .eq("id", delivery.subscription_id);
            if (error) throw error;
          }
        },
      ),
    );
    const { error: cleanupError } = await db
      .from("push_deliveries")
      .delete()
      .lt("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    if (cleanupError) throw cleanupError;
    const { count: failedLast24Hours, error: countError } = await db
      .from("push_deliveries")
      .select("id", { count: "exact", head: true })
      .gte("failed_at", new Date(Date.now() - 86400000).toISOString());
    if (countError) throw countError;
    return NextResponse.json(
      {
        processed: data?.length ?? 0,
        failedLast24Hours: failedLast24Hours ?? 0,
      },
      { status: failedLast24Hours ? 503 : 200 },
    );
  } catch {
    // Provider errors can contain subscription credentials; never log them.
    return NextResponse.json(
      { error: "Push delivery unavailable." },
      { status: 503 },
    );
  }
}
