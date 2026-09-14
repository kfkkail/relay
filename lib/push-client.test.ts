import { afterEach, expect, it, vi } from "vitest";
import { reconcileSubscription } from "./push-client";

afterEach(() => vi.unstubAllGlobals());
const subscription = {
  endpoint: "https://web.push.apple.com/token",
  toJSON: () => ({ endpoint: "https://web.push.apple.com/token", keys: {} }),
} as PushSubscription;
function registration(current: PushSubscription | null) {
  return {
    pushManager: { getSubscription: vi.fn().mockResolvedValue(current) },
  } as unknown as ServiceWorkerRegistration;
}

it("restores a server registration before reporting the browser subscription as enabled", async () => {
  let respond!: (value: unknown) => void;
  const fetch = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      respond = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetch);
  let enabled = false;
  const result = reconcileSubscription(registration(subscription)).then(
    (current) => {
      enabled = Boolean(current);
      return current;
    },
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(enabled).toBe(false);
  expect(fetch).toHaveBeenCalledWith(
    "/api/push/subscription",
    expect.objectContaining({ method: "POST" }),
  );
  respond({ ok: true });
  expect(await result).toBe(subscription);
  expect(enabled).toBe(true);
});

it.each([401, 409, 503])(
  "does not report enabled when registration fails with %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: "Registration failed" }),
      }),
    );
    await expect(
      reconcileSubscription(registration(subscription)),
    ).rejects.toThrow("Registration failed");
  },
);

it("does not create a subscription or request permission when none exists", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await reconcileSubscription(registration(null))).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
