import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  config: vi.fn(),
  payload: vi.fn(() => "{}"),
  runFilter: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/push", () => ({
  pushConfig: mocks.config,
  pushPayload: mocks.payload,
  pushStatus: (error: { statusCode?: number }) => error.statusCode ?? 0,
  sendPush: mocks.send,
}));
vi.mock("@/lib/push-delivery", async () => await import("./push-delivery"));
import { GET } from "../app/api/push/deliver/route";

let recentFailures = 0;
let updates: unknown[] = [];
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.clearAllMocks();
  recentFailures = 0;
  updates = [];
  mocks.config.mockReturnValue({});
  mocks.send.mockResolvedValue({ statusCode: 201 });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.from.mockImplementation((table: string) => {
    let count = false;
    const query = {
      select: (_columns: string, options?: { count?: string }) => {
        count = Boolean(options?.count);
        return query;
      },
      update: (value: unknown) => {
        updates.push(value);
        return query;
      },
      delete: () => query,
      eq: (column: string, value: string) => {
        if (table === "runs") mocks.runFilter(column, value);
        return query;
      },
      lt: () => query,
      gte: () => query,
      maybeSingle: async () => ({
        data:
          table === "runs"
            ? {
                result_markdown: "Your trip is booked.",
                tasks: { title: "Plan the trip" },
              }
            : {
                endpoint: "https://web.push.apple.com/token",
                p256dh: "key",
                auth: "auth",
              },
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          resolve({ error: null, ...(count ? { count: recentFailures } : {}) }),
        ),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());
const request = () =>
  new Request("https://relay.example/api/push/deliver", {
    headers: { authorization: "Bearer test-secret" },
  });

it("keeps signaling a recent terminal failure even when no deliveries remain", async () => {
  recentFailures = 2;
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ processed: 0, failedLast24Hours: 2 });
});
it("returns success when processing is healthy and no recent failures exist", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ processed: 0, failedLast24Hours: 0 });
});
it("persists exhausted provider failure and returns a redacted aggregate alarm", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        id: "delivery",
        subscription_id: "subscription",
        task_id: "task",
        run_id: "original-run",
        outcome: "completed",
        attempts: 6,
      },
    ],
    error: null,
  });
  mocks.send.mockRejectedValue({
    statusCode: 403,
    body: "private-provider-details",
  });
  recentFailures = 1;
  const response = await GET(request());
  expect(mocks.runFilter).toHaveBeenCalledWith("id", "original-run");
  expect(mocks.runFilter).toHaveBeenCalledWith("task_id", "task");
  expect(mocks.payload).toHaveBeenCalledWith("completed", "task", "delivery", {
    title: "Plan the trip",
    result: "Your trip is booked.",
  });
  expect(updates[0]).toMatchObject({
    last_status_code: 403,
    failed_at: expect.any(String),
  });
  expect(updates[0]).not.toHaveProperty("delivered_at");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ processed: 1, failedLast24Hours: 1 });
});
it("does not expose monitoring or claim work without scheduler authentication", async () => {
  const response = await GET(
    new Request("https://relay.example/api/push/deliver"),
  );
  expect(response.status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
