import webpush from "web-push";
import { ApiError } from "./api-error";

export function pushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject)
    throw new ApiError("Push notifications are not configured.", 503);
  return { publicKey, privateKey, subject };
}

// Only browser push services are valid destinations, never arbitrary URLs.
export function validateSubscription(value: unknown): webpush.PushSubscription {
  const input = value as Partial<webpush.PushSubscription> | null;
  if (
    !input ||
    typeof input.endpoint !== "string" ||
    input.endpoint.length > 4096
  )
    throw new ApiError("Invalid subscription.");
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    throw new ApiError("Invalid subscription.");
  }
  const host = endpoint.hostname;
  const allowed =
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".notify.windows.com");
  if (
    !allowed ||
    endpoint.protocol !== "https:" ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new ApiError("Unsupported push service.");
  const keys = input.keys;
  if (
    !keys ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    !/^[\w-]+$/.test(keys.p256dh) ||
    !/^[\w-]+$/.test(keys.auth) ||
    Buffer.from(keys.p256dh, "base64url").length !== 65 ||
    Buffer.from(keys.auth, "base64url").length !== 16
  )
    throw new ApiError("Invalid subscription keys.");
  return {
    endpoint: endpoint.toString(),
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

export function pushPayload(outcome: string, taskId?: string, id = "test") {
  return JSON.stringify({
    title:
      outcome === "completed"
        ? "Result ready to review"
        : outcome === "failed"
          ? "Run needs attention"
          : "Notifications are working",
    body:
      outcome === "test"
        ? "Relay can now notify you on this device."
        : "Open Relay to review your task.",
    tag: `relay-${id}`,
    url: taskId ? `/tasks/${taskId}` : "/tasks",
  });
}

export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: string,
) {
  const config = pushConfig();
  return webpush.sendNotification(validateSubscription(subscription), payload, {
    vapidDetails: config,
    TTL: 3600,
    timeout: 10000,
  });
}

export function pushStatus(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : 0;
}
