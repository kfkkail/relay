import { subscriptionRequest } from "./push-client";

export async function signOutDevice() {
  // Do not wait indefinitely for a service worker on unsupported/unregistered browsers.
  const registration =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined;
  const subscription =
    registration && "pushManager" in registration
      ? await registration.pushManager.getSubscription()
      : null;
  if (subscription) {
    await subscriptionRequest("DELETE", subscription);
    await subscription.unsubscribe();
  }
  const response = await fetch("/auth/sign-out", { method: "POST" });
  if (!response.ok) throw new Error("Sign-out failed.");
}
