import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../app/api/workers/[workerId]/route";
import { requireWorker } from "./worker-auth";

const state = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  revoked: false,
  owner: "owner",
}));

// Model the database filters so the route and bearer authentication share state.
const database = vi.hoisted(() => ({
  from: vi.fn(() => {
    const filters: Record<string, unknown> = {};
    let updates: Record<string, unknown> | undefined;
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: Record<string, unknown>) => {
        updates = value;
        return query;
      }),
      eq: vi.fn((key: string, value: unknown) => {
        filters[key] = value;
        return query;
      }),
      is: vi.fn((key: string, value: unknown) => {
        filters[key] = value;
        return query;
      }),
      maybeSingle: vi.fn(async () => {
        if (
          (filters.user_id && filters.user_id !== state.owner) ||
          (filters.id && filters.id !== "worker") ||
          ("revoked_at" in filters && state.revoked)
        )
          return { data: null, error: null };
        if (updates?.revoked_at) state.revoked = true;
        return {
          data: { id: "worker", user_id: state.owner, name: "Laptop" },
          error: null,
        };
      }),
    };
    return query;
  }),
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => database }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database }));

const revoke = (workerId = "worker") =>
  DELETE(
    new Request("http://localhost/api/workers/worker", { method: "DELETE" }),
    {
      params: Promise.resolve({ workerId }),
    },
  );
const workerRequest = () =>
  new Request("http://localhost/api/worker/runs/claim", {
    headers: { Authorization: "Bearer relay_test" },
  });

beforeEach(() => {
  state.user = { id: "owner" };
  state.owner = "owner";
  state.revoked = false;
  vi.clearAllMocks();
});

describe("worker token revocation", () => {
  it("accepts an active token and rejects it after its owner revokes it", async () => {
    await expect(requireWorker(workerRequest())).resolves.toMatchObject({
      worker: { id: "worker" },
    });
    expect((await revoke()).status).toBe(204);
    expect(state.revoked).toBe(true);
    await expect(requireWorker(workerRequest())).rejects.toMatchObject({
      status: 401,
    });
    expect((await revoke()).status).toBe(404);
  });

  it("requires a signed-in owner", async () => {
    state.user = null;
    expect((await revoke()).status).toBe(401);
    expect(database.from).not.toHaveBeenCalled();
  });

  it("cannot revoke another owner's worker", async () => {
    state.owner = "someone-else";
    expect((await revoke()).status).toBe(404);
    expect(state.revoked).toBe(false);
  });

  it("returns 404 for an unknown worker", async () => {
    expect((await revoke("missing")).status).toBe(404);
    expect(state.revoked).toBe(false);
  });
});
