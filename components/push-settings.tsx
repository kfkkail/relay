"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { reconcileSubscription, subscriptionRequest } from "@/lib/push-client";

export function PushSettings() {
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    )
      return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then(async (registration) => {
        if (!cancelled) setSupported(true);
        return reconcileSubscription(registration);
      })
      .then((current) => {
        if (!cancelled) setSubscription(current);
      })
      .catch((error) => {
        if (!cancelled)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not verify notification settings. Try enabling again.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      // Request directly from the tap, before any asynchronous network work.
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications are blocked. Allow them in your device’s notification settings.",
        );
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(
        atob(publicKey!.replace(/-/g, "+").replace(/_/g, "/")),
        (character) => character.charCodeAt(0),
      );
      const current = await registration.pushManager.getSubscription();
      const next =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      await subscriptionRequest("POST", next);
      setSubscription(next);
      setMessage(
        "Result-ready and failed-run notifications enabled on this device.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    try {
      await subscriptionRequest("DELETE", subscription);
      await subscription.unsubscribe();
      setSubscription(null);
      setMessage("Notifications disabled on this device.");
    } catch {
      setMessage("Could not disable notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!subscription) return;
    setBusy(true);
    try {
      // Reconcile a browser subscription after restoring server data or re-login.
      await subscriptionRequest("POST", subscription);
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage("Test sent. Check Notification Center if no banner appears.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Test delivery failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-settings">
      <button
        className="icon-button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={20} />
      </button>
      {open && (
        <section
          className="push-settings-panel"
          aria-label="Notification settings"
        >
          <h2>Notifications</h2>
          <p>
            Get notified when a result is ready or a run needs attention. On
            shared devices, disable notifications before signing out.
          </p>
          {!supported && (
            <p>
              On iPhone, add Relay to your Home Screen, then open it from its
              icon. Requires iOS 16.4 or later.
            </p>
          )}
          {!publicKey && (
            <p>Push notifications have not been configured on this server.</p>
          )}
          {supported && publicKey && (
            <div className="push-settings-buttons">
              <button
                disabled={busy || loading}
                onClick={subscription ? disable : enable}
              >
                {loading
                  ? "Checking notifications…"
                  : subscription
                    ? "Disable on this device"
                    : "Enable notifications"}
              </button>
              {subscription && (
                <button disabled={busy || loading} onClick={test}>
                  Send test notification
                </button>
              )}
            </div>
          )}
          <p role="status">{message}</p>
        </section>
      )}
    </div>
  );
}
