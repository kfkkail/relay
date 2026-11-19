import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/worker/wakeup/route";
import { ApiError } from "./http";
import { requireWorker } from "./worker-auth";

vi.mock("./worker-auth", () => ({ requireWorker: vi.fn() }));

const request = new Request("https://relay.example/api/worker/wakeup", {
  method: "POST",
});
const worker = { id: "worker-id", user_id: "owner-id", name: "Pi" };
const secret = "test-signing-secret";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("rejects unauthorized workers", async () => {
  vi.mocked(requireWorker).mockRejectedValue(new ApiError("Unauthorized", 401));
  expect((await POST(request)).status).toBe(401);
});

it("allows authorized workers to fall back to polling when disabled", async () => {
  vi.stubEnv("SUPABASE_JWT_SECRET", "");
  vi.mocked(requireWorker).mockResolvedValue({ worker, supabase: {} as never });
  expect((await POST(request)).status).toBe(204);
});

it("signs a short-lived read credential for the worker's owner", async () => {
  vi.stubEnv("SUPABASE_JWT_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.mocked(requireWorker).mockResolvedValue({ worker, supabase: {} as never });

  const response = await POST(request);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const { token, topic, expiresAt } = await response.json();
  expect(topic).toBe("relay-worker-wakeup:owner-id");
  const [header, body, signature] = token.split(".");
  expect(signature).toBe(
    createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url"),
  );
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  expect(claims).toEqual({
    role: "anon",
    aud: "authenticated",
    iat: expiresAt - 300,
    exp: expiresAt,
    relay_worker_wakeup_topic: topic,
  });
});
