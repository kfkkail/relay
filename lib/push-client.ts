export async function subscriptionRequest(
  method: string,
  subscription: PushSubscription,
) {
  const response = await fetch("/api/push/subscription", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      method === "POST"
        ? subscription.toJSON()
        : { endpoint: subscription.endpoint },
    ),
  });
  if (!response.ok)
    throw new Error(
      (await response.json()).error || "Could not save notification settings.",
    );
}

// A browser subscription alone does not mean the server can enqueue pushes.
export async function reconcileSubscription(
  registration: ServiceWorkerRegistration,
) {
  const current = await registration.pushManager.getSubscription();
  if (current) await subscriptionRequest("POST", current);
  return current;
}
