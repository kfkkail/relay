import { afterEach, expect, it, vi } from "vitest";
import { signOutDevice } from "./sign-out-device";
afterEach(() => vi.unstubAllGlobals());

it("removes server and browser subscriptions before ending the session", async () => {
  const calls: string[] = [];
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({
            endpoint: "https://web.push.apple.com/device",
            unsubscribe: async () => {
              calls.push("unsubscribe");
              return true;
            },
          }),
        },
      }),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true };
    }),
  );
  await signOutDevice();
  expect(calls).toEqual([
    "/api/push/subscription",
    "unsubscribe",
    "/auth/sign-out",
  ]);
});
it("does not end the session if server subscription removal fails", async () => {
  const unsubscribe = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ endpoint: "endpoint", unsubscribe }),
        },
      }),
    },
  });
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Unavailable" }),
  });
  vi.stubGlobal("fetch", fetch);
  await expect(signOutDevice()).rejects.toThrow("Unavailable");
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("signs out normally on a browser without service workers", async () => {
  vi.stubGlobal("navigator", {});
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  await signOutDevice();
  expect(fetch).toHaveBeenCalledWith("/auth/sign-out", { method: "POST" });
});
