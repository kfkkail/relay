import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  admin: { source: "admin" },
  workerDb: { source: "worker" },
}));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual("@/lib/http")),
  requireUser: async () => ({ user: { id: "owner" } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.admin,
}));
vi.mock("@/lib/worker-auth", () => ({
  requireWorker: async () => ({
    supabase: mocks.workerDb,
    worker: { user_id: "worker-owner" },
  }),
}));
vi.mock("@/lib/vehicles/nhtsa-backfill", () => ({
  backfillNhtsa: mocks.backfill,
}));
import { POST as userPost } from "@/app/api/vehicles/nhtsa/route";
import { POST as workerPost } from "@/app/api/worker/vehicles/nhtsa/route";
const request = (body: object) =>
  new Request("https://relay.example/api/vehicles/nhtsa", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.backfill.mockResolvedValue({ checked: 10, nextCursor: null });
});
it("derives the owner from authentication, never request data", async () => {
  expect((await userPost(request({ userId: "other" }))).status).toBe(200);
  expect(mocks.backfill).toHaveBeenCalledWith(mocks.admin, "owner", null);
  expect((await workerPost(request({ userId: "other" }))).status).toBe(200);
  expect(mocks.backfill).toHaveBeenCalledWith(
    mocks.workerDb,
    "worker-owner",
    null,
  );
});
it("rejects malformed cursors before reading vehicles", async () => {
  for (const post of [userPost, workerPost]) {
    for (const cursor of ["bad", 42, { id: "other" }])
      expect((await post(request({ cursor }))).status).toBe(400);
  }
  expect(mocks.backfill).not.toHaveBeenCalled();
});
