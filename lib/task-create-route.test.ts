import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual("@/lib/http")),
  requireUser: async () => ({
    supabase: { from: mocks.from },
    user: { id: "owner" },
  }),
}));
vi.mock("@/lib/queue-task", () => ({ queueTask: mocks.queue }));
import { POST } from "../app/api/tasks/route";

let deleted: boolean;
let reads: number;
beforeEach(() => {
  vi.clearAllMocks();
  deleted = false;
  reads = 0;
  mocks.queue.mockResolvedValue("run");
  mocks.from.mockImplementation(() => {
    const query = {
      insert: vi.fn(() => query),
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      delete: vi.fn(() => {
        deleted = true;
        return query;
      }),
      single: vi.fn(async () => ({
        data: { id: "task", status: reads++ ? "ready" : "inbox" },
        error: null,
      })),
    };
    return query;
  });
});
const request = (body: Record<string, unknown>) =>
  new Request("https://relay.example/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "New task", ...body }),
  });
it("automatically queues a new task and returns its queued state", async () => {
  const response = await POST(request({}));
  expect(response.status).toBe(201);
  expect(mocks.queue).toHaveBeenCalledWith(
    expect.anything(),
    { id: "owner" },
    "task",
  );
  expect((await response.json()).task.status).toBe("ready");
});
it("waits for image upload before publishing a run", async () => {
  const response = await POST(request({ hasAttachment: true }));
  expect(response.status).toBe(201);
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("rejects conflicting instructions before saving a task", async () => {
  const response = await POST(request({ instructions: "Proposal only" }));
  expect(response.status).toBe(409);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("removes the newly created task if queueing fails", async () => {
  const { ApiError } = await import("./http");
  mocks.queue.mockRejectedValue(new ApiError("Queue unavailable", 503));
  expect((await POST(request({}))).status).toBe(503);
  expect(deleted).toBe(true);
});
