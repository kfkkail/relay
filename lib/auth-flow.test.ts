import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  oauth: vi.fn(),
  exchange: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithOAuth: mocks.oauth,
      exchangeCodeForSession: mocks.exchange,
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
}));
vi.mock("@/lib/auth-redirect", async () => await import("./auth-redirect"));
import { POST } from "../app/auth/sign-in/route";
import { GET } from "../app/auth/callback/route";
const origin = "https://relay-eta-wine.vercel.app";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.oauth.mockResolvedValue({
    data: {
      url: "https://example.supabase.co/auth/v1/authorize?provider=github",
    },
    error: null,
  });
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.cookie.mockReturnValue(undefined);
});
function signIn(next = "/tasks/123?from=%2Ftasks", requestOrigin = origin) {
  return POST(
    new Request(`${origin}/auth/sign-in`, {
      method: "POST",
      headers: { origin: requestOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ next }),
    }),
  );
}
it("always requests the exact allowlisted callback and stores the destination in a protected cookie", async () => {
  const response = await signIn();
  expect(response.status).toBe(200);
  expect(mocks.oauth).toHaveBeenCalledWith({
    provider: "github",
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain(
    "relay-auth-return=%2Ftasks%2F123%3Ffrom%3D%252Ftasks",
  );
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).toContain("Max-Age=600");
  expect(cookie).toContain("Path=/auth");
});
it("rejects cross-origin initiation", async () => {
  expect((await signIn("/tasks", "https://evil.example")).status).toBe(403);
  expect(mocks.oauth).not.toHaveBeenCalled();
});
it("returns a retryable error when OAuth setup fails", async () => {
  mocks.oauth.mockRejectedValue(new Error("private provider failure"));
  const response = await signIn();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private provider failure");
});
it("exchanges the code and restores the cookie destination, then clears it", async () => {
  mocks.cookie.mockReturnValue({ value: "/tasks/123?from=%2Ftasks" });
  const response = await GET(
    new Request(`${origin}/auth/callback?code=example-code`),
  );
  expect(mocks.exchange).toHaveBeenCalledWith("example-code");
  expect(response.headers.get("location")).toBe(
    `${origin}/tasks/123?from=%2Ftasks`,
  );
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("set-cookie")).toContain("Path=/auth");
});
it("does not redirect outside Relay even if the return cookie is altered", async () => {
  mocks.cookie.mockReturnValue({ value: "https://evil.example" });
  expect(
    (await GET(new Request(`${origin}/auth/callback?code=test`))).headers.get(
      "location",
    ),
  ).toBe(`${origin}/my-work`);
});
it("retains compatibility with callbacks already in flight", async () => {
  expect(
    (
      await GET(
        new Request(`${origin}/auth/callback?code=test&next=%2Ftasks%2F123`),
      )
    ).headers.get("location"),
  ).toBe(`${origin}/tasks/123`);
});
it.each(["missing", "denied", "invalid", "throws"])(
  "shows a retryable failure for %s callbacks and clears stale return state",
  async (mode) => {
    if (mode === "invalid")
      mocks.exchange.mockResolvedValue({
        error: new Error("private exchange error"),
      });
    if (mode === "throws")
      mocks.exchange.mockRejectedValue(new Error("network failure"));
    const query =
      mode === "missing"
        ? ""
        : mode === "denied"
          ? "?error=access_denied"
          : "?code=test";
    const response = await GET(new Request(`${origin}/auth/callback${query}`));
    expect(response.headers.get("location")).toBe(
      `${origin}/my-work?auth_error=1`,
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  },
);
