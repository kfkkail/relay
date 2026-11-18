import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/worker-auth", () => ({
  requireWorker: async () => ({
    supabase: { rpc: mocks.rpc },
    worker: { id: "worker" },
  }),
}));
import { POST } from "../app/api/worker/runs/claim/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});
it("does not send conversation work to legacy workers", async () => {
  const response = await POST(
    new Request("https://relay.example/api/worker/runs/claim", {
      method: "POST",
    }),
  );
  expect(response.status).toBe(204);
  expect(mocks.rpc).toHaveBeenCalledWith("claim_next_run_with_chat", {
    p_worker_id: "worker",
    p_include_chat: false,
  });
});
it("selects conversational policy from server metadata for capable workers", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        run_id: "run",
        task_id: "task",
        conversation_id: "conversation",
        deliverable: "investigation",
      },
    ],
    error: null,
  });
  const response = await POST(
    new Request("https://relay.example/api/worker/runs/claim", {
      method: "POST",
      body: JSON.stringify({ chat: true }),
    }),
  );
  expect(mocks.rpc).toHaveBeenCalledWith("claim_next_run_with_chat", {
    p_worker_id: "worker",
    p_include_chat: true,
  });
  expect((await response.json()).task.conversation).toBe(true);
});
