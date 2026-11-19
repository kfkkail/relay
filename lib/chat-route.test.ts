import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual("@/lib/http")),
  requireUser: mocks.auth,
}));
import { POST, GET } from "../app/api/chat/route";
import { ApiError } from "./http";
const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const request = (body: unknown) =>
  new Request("https://relay.example/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    supabase: { rpc: mocks.rpc, from: mocks.from },
    user: { id: "owner" },
  });
  mocks.rpc.mockResolvedValue({ data: messageId, error: null });
});
it("authenticates reads and writes", async () => {
  mocks.auth.mockRejectedValue(new ApiError("Sign in required.", 401));
  expect(
    (await GET(new Request("https://relay.example/api/chat"))).status,
  ).toBe(401);
  expect((await POST(request({}))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects invalid IDs and empty or oversized messages before queueing", async () => {
  for (const body of [
    null,
    [],
    { conversationId: "bad", messageId, message: "Hi" },
    { conversationId, messageId, message: " " },
    { conversationId, messageId, message: "x".repeat(4001) },
  ]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses the atomic owner-scoped RPC and stable client message ID", async () => {
  expect(
    (await POST(request({ conversationId, messageId, message: " Hello " })))
      .status,
  ).toBe(201);
  expect(mocks.rpc).toHaveBeenCalledWith("send_chat_message", {
    p_conversation_id: conversationId,
    p_message_id: messageId,
    p_message: "Hello",
  });
});
it("reports active-turn conflicts without creating another run", async () => {
  mocks.rpc.mockResolvedValue({
    error: {
      message: "Wait for the current reply before sending another message",
    },
  });
  expect(
    (await POST(request({ conversationId, messageId, message: "Hello" })))
      .status,
  ).toBe(409);
});
it("disambiguates run relationships and bounds chat reads", async () => {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: [], error: null }),
  };
  mocks.from.mockReturnValue(query);
  expect(
    (
      await GET(
        new Request(`https://relay.example/api/chat?id=${conversationId}`),
      )
    ).status,
  ).toBe(200);
  expect(query.select).toHaveBeenCalledWith(
    expect.stringContaining("runs:runs!runs_task_id_fkey("),
  );
  expect(query.select).toHaveBeenCalledWith(
    expect.stringContaining(
      "result_documents(id,display_filename,mime_type,byte_size,description)",
    ),
  );
  expect(query.eq).toHaveBeenCalledWith("conversation_id", conversationId);
  expect(query.limit).toHaveBeenCalledWith(100);
});
