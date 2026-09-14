import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const context = {
    URL,
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      location: { origin: "https://relay.example" },
      registration: { showNotification },
      clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow },
    },
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  return { handlers, showNotification, openWindow };
}

it("shows a visible fallback even for malformed pushes", async () => {
  const { handlers, showNotification } = worker();
  let work: Promise<unknown> | undefined;
  handlers.push({
    data: {
      json() {
        throw new Error("malformed");
      },
    },
    waitUntil(promise: Promise<unknown>) {
      work = promise;
    },
  });
  await work;
  expect(showNotification).toHaveBeenCalledWith(
    "Relay needs your attention",
    expect.objectContaining({ body: "Open Relay to review your tasks." }),
  );
});

it.each([
  ["/tasks/1234-abcd", "https://relay.example/tasks/1234-abcd"],
  ["https://evil.example/tasks", "https://relay.example/tasks"],
  ["/auth/sign-out", "https://relay.example/tasks"],
])("opens only safe task destinations: %s", async (url, expected) => {
  const { handlers, openWindow } = worker();
  let work: Promise<unknown> | undefined;
  handlers.notificationclick({
    notification: { close: vi.fn(), data: { url } },
    waitUntil(promise: Promise<unknown>) {
      work = promise;
    },
  });
  await work;
  expect(openWindow).toHaveBeenCalledWith(expected);
});
