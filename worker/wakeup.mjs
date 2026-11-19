import { setTimeout as delay } from "node:timers/promises";

export function createWakeSignal() {
  let pending = false;
  let wake;
  return {
    get pending() {
      return pending;
    },
    notify() {
      pending = true;
      wake?.();
    },
    clear() {
      pending = false;
    },
    async wait(milliseconds) {
      if (pending) return;
      await new Promise((resolve) => {
        const timer = setTimeout(finish, milliseconds);
        wake = finish;
        function finish() {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        }
      });
    },
  };
}

export async function listenForWakeups({ request, notify, signal }) {
  let client;
  let token;
  let subscribed = false;
  try {
    while (!signal.aborted) {
      let refreshAfter = 60_000;
      try {
        const config = await request("/api/worker/wakeup", {
          method: "POST",
          signal,
        });
        if (signal.aborted) break;
        if (config) {
          token = config.token;
          if (!client) {
            const { createClient } = await import("@supabase/supabase-js");
            if (signal.aborted) break;
            client = createClient(config.url, config.publishableKey, {
              accessToken: async () => token,
            });
          }
          await client.realtime.setAuth(token);
          if (signal.aborted) break;
          // A rejected join can leave an errored channel registered in the SDK.
          // Retry it with fresh credentials if the SDK has not rejoined it.
          if (!subscribed && client.getChannels().length > 0)
            await client.removeAllChannels();
          if (signal.aborted) break;
          if (client.getChannels().length === 0) {
            client
              .channel(config.topic, { config: { private: true } })
              .on("broadcast", { event: "queued" }, notify)
              .subscribe((status) => {
                subscribed = status === "SUBSCRIBED";
                if (subscribed) notify();
              });
          }
          refreshAfter = Math.max(
            1000,
            config.expiresAt * 1000 - Date.now() - 60_000,
          );
        } else if (client) {
          await client.removeAllChannels();
          client = undefined;
          token = undefined;
          subscribed = false;
        }
      } catch {
        if (!signal.aborted)
          console.warn(
            "Worker wake-up connection could not be configured. Polling remains available.",
          );
      }
      await delay(refreshAfter, undefined, { signal });
    }
  } finally {
    await client?.removeAllChannels();
  }
}
