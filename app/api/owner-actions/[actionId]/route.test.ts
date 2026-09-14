import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http")>()),
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { DELETE } from "./route";

describe("DELETE /api/owner-actions/:actionId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("removes every stored photo before deleting the action", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const deleteAction = vi.fn().mockResolvedValue({ error: null, count: 1 });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "action-1",
        owner_action_attachments: [
          { storage_path: "user/owner-actions/action-1/photo-1" },
          { storage_path: "user/owner-actions/action-1/photo-2" },
        ],
      },
      error: null,
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single })),
        })),
        delete: vi.fn(() => ({ eq: deleteAction })),
      })),
    };
    mocks.requireUser.mockResolvedValue({ supabase });
    mocks.createAdminClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ remove })) },
    });

    const response = await DELETE(new Request("http://relay.test"), {
      params: Promise.resolve({ actionId: "action-1" }),
    });

    expect(response.status).toBe(204);
    expect(remove).toHaveBeenCalledWith([
      "user/owner-actions/action-1/photo-1",
      "user/owner-actions/action-1/photo-2",
    ]);
    expect(deleteAction).toHaveBeenCalledWith("id", "action-1");
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAction.mock.invocationCallOrder[0],
    );
  });
});
