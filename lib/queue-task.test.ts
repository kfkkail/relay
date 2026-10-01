import { expect, it, vi } from "vitest";
import { queueTask } from "./queue-task";

function client(runs: { status: string }[] = [], instructions = "") {
  const rpc = vi.fn().mockResolvedValue({ data: "run-id", error: null });
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({
      data: {
        id: "task",
        runs,
        deliverable: "implementation_pr",
        instructions,
      },
      error: null,
    }),
    insert: vi.fn(),
  };
  const supabase = { from: () => query, rpc };
  return {
    supabase: supabase as unknown as Parameters<typeof queueTask>[0],
    rpc,
  };
}
it("publishes the run using the atomic queue operation", async () => {
  const { supabase, rpc } = client();
  expect(await queueTask(supabase, { id: "owner" }, "task")).toBe("run-id");
  expect(rpc).toHaveBeenCalledWith("queue_task", { p_task_id: "task" });
});
it.each(["queued", "working"])(
  "rejects a task with a %s run",
  async (status) => {
    const { supabase, rpc } = client([{ status }]);
    await expect(queueTask(supabase, { id: "owner" }, "task")).rejects.toThrow(
      "already has an active run",
    );
    expect(rpc).not.toHaveBeenCalled();
  },
);
it("keeps deliverable conflict protection", async () => {
  const { supabase, rpc } = client([], "Proposal only");
  await expect(queueTask(supabase, { id: "owner" }, "task")).rejects.toThrow(
    "prohibit implementation",
  );
  expect(rpc).not.toHaveBeenCalled();
});
it("propagates queue transaction errors", async () => {
  const { supabase, rpc } = client();
  rpc.mockResolvedValue({ data: null, error: new Error("Upload incomplete") });
  await expect(queueTask(supabase, { id: "owner" }, "task")).rejects.toThrow(
    "Upload incomplete",
  );
});
