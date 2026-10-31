import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorker: vi.fn() }));

vi.mock("@/lib/worker-auth", () => ({
  requireWorker: mocks.requireWorker,
}));

import { POST } from "@/app/api/worker/runs/[runId]/heartbeat/route";

function database(result: { data: { id: string } | null; error: unknown }) {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return { from: vi.fn().mockReturnValue(query), query };
}

describe("agent run heartbeat route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renews only the active run assigned to the worker", async () => {
    const db = database({ data: { id: "run-1" }, error: null });
    mocks.requireWorker.mockResolvedValue({
      supabase: db,
      worker: { id: "worker-1" },
    });

    const response = await POST(new Request("https://relay.test"), {
      params: Promise.resolve({ runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ heartbeat: true });
    expect(db.query.eq.mock.calls).toEqual([
      ["id", "run-1"],
      ["worker_id", "worker-1"],
      ["job_kind", "agent"],
      ["status", "working"],
    ]);
  });

  it("rejects a heartbeat after the run is no longer active", async () => {
    const db = database({ data: null, error: null });
    mocks.requireWorker.mockResolvedValue({
      supabase: db,
      worker: { id: "worker-1" },
    });

    const response = await POST(new Request("https://relay.test"), {
      params: Promise.resolve({ runId: "expired-run" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Active agent run not found for this worker.",
    });
  });
});
