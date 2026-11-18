import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/worker-auth", () => ({
  requireWorker: async () => ({
    supabase: mocks,
    worker: { id: "worker", user_id: "owner" },
  }),
}));
import { POST } from "@/app/api/worker/runs/[runId]/vehicles/route";

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: "run",
        job_kind: "vehicle_search",
        job_payload: { detail_vehicle: "vehicle" },
      },
    })),
  };
  mocks.from.mockReturnValue(query);
  mocks.rpc.mockResolvedValue({ error: null, data: null });
});
const result = (body: object) =>
  POST(
    new Request("https://relay.example/api/worker/runs/run/vehicles", {
      method: "POST",
      body: JSON.stringify({ lease: "lease", ...body }),
    }),
    { params: Promise.resolve({ runId: "run" }) },
  );

it("bounds configuration evidence and excludes unrelated worker fields", async () => {
  expect(
    (
      await result({
        action: "enrichment",
        attributes: {
          battery_pack: "large",
          motor: "impossible",
          battery_evidence: "x".repeat(2000),
          motor_evidence: null,
          price: 1,
          decision: "passed",
        },
      })
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("complete_vehicle_enrichment", {
    p_run: "run",
    p_worker: "worker",
    p_lease: "lease",
    p_attributes: {
      battery_pack: "large",
      motor: null,
      battery_evidence: "x".repeat(1500),
      motor_evidence: null,
    },
  });
});
it("cannot finalize an inventory scan or upload batches using a targeted job", async () => {
  for (const action of ["batch", "finalize", "photos"]) {
    expect((await result({ action })).status).toBe(400);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("accepts only bounded structured failure diagnostics", async () => {
  expect(
    (
      await result({
        action: "enrichment_failure",
        failure: {
          code: "access_denied",
          host: "www.carvana.com",
          http_status: 403,
          responseBody: "secret",
        },
      })
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("fail_vehicle_enrichment", {
    p_run: "run",
    p_worker: "worker",
    p_lease: "lease",
    p_failure: {
      code: "access_denied",
      host: "www.carvana.com",
      http_status: 403,
    },
  });
  mocks.rpc.mockClear();
  for (const patch of [
    { code: "unknown" },
    { host: "https://user:secret@example.com/path" },
    { host: "dealer.example\n" },
    { http_status: 999 },
    { network_code: "secret\nlog injection" },
    { network_code: "ECONNRESET\n" },
  ]) {
    expect(
      (
        await result({
          action: "enrichment_failure",
          failure: { code: "network_error", host: "dealer.example", ...patch },
        })
      ).status,
    ).toBe(400);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
