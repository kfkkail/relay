"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return;

    void navigator.serviceWorker.register("/sw.js");
    if (Notification.permission === "granted") {
      void registerForNotifications();
      return;
    }
    if (Notification.permission === "denied") {
      return;
    }

    // Browsers require a user gesture before showing the permission prompt.
    const register = () => {
      window.removeEventListener("pointerdown", register);
      window.removeEventListener("keydown", register);
      void registerForNotifications();
    };
    window.addEventListener("pointerdown", register, { once: true });
    window.addEventListener("keydown", register, { once: true });
    return () => {
      window.removeEventListener("pointerdown", register);
      window.removeEventListener("keydown", register);
    };
  }, []);
  return null;
}

async function registerForNotifications() {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (permission !== "granted" || !publicKey) return;

    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription),
    });
  } catch {
    // Notifications are progressive enhancement and must not block the app.
  }
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}
