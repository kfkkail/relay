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

import { POST } from "./route";

describe("POST /api/owner-actions/:actionId/attachments", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the atomic reservation and rejects a full action", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "limit_reached",
        abandoned: [
          {
            id: "stale-attachment",
            storagePath: "user-1/owner-actions/action-1/stale-attachment",
          },
        ],
      },
      error: null,
    });
    const deleteAbandonedRows = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          in: vi.fn(() => ({ not: deleteAbandonedRows })),
        })),
      })),
    };
    mocks.requireUser.mockResolvedValue({
      supabase,
      user: { id: "user-1" },
    });
    const createSignedUploadUrl = vi.fn();
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      rpc,
      storage: {
        from: vi.fn(() => ({ createSignedUploadUrl, remove })),
      },
    });

    const response = await POST(
      new Request("http://relay.test", {
        method: "POST",
        body: JSON.stringify({
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          byteSize: 1024,
        }),
      }),
      { params: Promise.resolve({ actionId: "action-1" }) },
    );

    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_owner_action_attachment",
      expect.objectContaining({
        p_user_id: "user-1",
        p_action_id: "action-1",
        p_file_name: "photo.jpg",
      }),
    );
    expect(remove).toHaveBeenCalledWith([
      "user-1/owner-actions/action-1/stale-attachment",
    ]);
    expect(deleteAbandonedRows).toHaveBeenCalledWith(
      "abandoned_at",
      "is",
      null,
    );
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
