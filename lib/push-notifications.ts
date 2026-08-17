import webpush from "web-push";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function notifyTaskWaiting(
  supabase: AdminClient,
  task: { id: string; user_id: string; title: string },
) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("user_id", task.user_id);
  if (error || !subscriptions?.length) return;

  const payload = JSON.stringify({
    title: "Task waiting",
    body: `${task.title} is ready for your review.`,
    taskId: task.id,
  });
  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 86400, timeout: 5000, urgency: "high" });
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? error.statusCode
        : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      }
    }
  }));
}
