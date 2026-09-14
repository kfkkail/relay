import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  getCookie: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/push-cookie", async () => await import("./push-cookie"));
import { POST } from "../app/auth/sign-out/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.getCookie.mockReturnValue({ value: "device-id" });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
const request = () =>
  new Request("https://relay.example/auth/sign-out", { method: "POST" });
it("uses the device cookie and authenticated owner, and signs out only the current session", async () => {
  const response = await POST(request());
  expect(mocks.rpc).toHaveBeenCalledWith("remove_push_subscription", {
    p_user_id: "owner",
    p_subscription_id: "device-id",
  });
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toContain("relay-push-device=;");
});
it("leaves the session intact if notification cleanup fails", async () => {
  mocks.rpc.mockResolvedValue({ error: new Error("database failure") });
  expect((await POST(request())).status).toBe(503);
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("does not touch other devices when no current-device cookie is present", async () => {
  mocks.getCookie.mockReturnValue(undefined);
  expect((await POST(request())).status).toBe(303);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
