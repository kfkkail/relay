const CACHE_NAME = "relay-shell-v1";
const SHELL_ASSETS = ["/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/"))
    return;
  if (!["style", "script", "image", "font"].includes(request.destination))
    return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok)
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()));
          return response;
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    /* Display a safe fallback. */
  }
  event.waitUntil(
    self.registration.showNotification(
      payload.title || "Relay needs your attention",
      {
        body: payload.body || "Open Relay to review your tasks.",
        icon: "/icon.svg",
        tag: payload.tag || "relay",
        data: { url: payload.url || "/tasks" },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      let url = new URL("/tasks", self.location.origin);
      try {
        const candidate = new URL(
          event.notification.data?.url || "/tasks",
          self.location.origin,
        );
        if (
          candidate.origin === self.location.origin &&
          /^\/tasks(?:\/[a-f0-9-]+)?$/.test(candidate.pathname)
        )
          url = candidate;
      } catch {
        /* Use the task list for malformed destinations. */
      }
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          const navigated = await client.navigate(url.href);
          if (navigated) {
            await navigated.focus();
            return;
          }
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
