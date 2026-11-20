import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signUpload: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  auth: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual("@/lib/http")),
  requireUser: mocks.auth,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: mocks.signUpload,
        download: mocks.download,
        upload: mocks.upload,
        remove: mocks.remove,
      }),
    },
  }),
}));
import { POST, GET } from "../app/api/chat/route";
import { POST as signUpload } from "../app/api/chat/uploads/route";
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
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
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
    not: vi.fn(() => query),
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

it("normalizes the staged image before atomically queueing the chat turn", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({
    create: { width: 10, height: 20, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  mocks.download.mockResolvedValue({
    data: new Blob([new Uint8Array(png)]),
    error: null,
  });
  mocks.rpc.mockImplementation(async (_name, args) => ({
    data: {
      messageId,
      storagePath: `owner/${messageId}/${args.p_image.objectId}`,
    },
    error: null,
  }));

  const uploadId = "00000000-0000-4000-8000-000000000003";
  const response = await POST(
    request({
      conversationId,
      messageId,
      message: "What is in this image?",
      image: {
        uploadId,
        fileName: "photo.png",
        mimeType: "image/png",
        byteSize: png.byteLength,
      },
    }),
  );
  expect(response.status).toBe(201);
  expect(mocks.download).toHaveBeenCalledWith(`owner/chat-uploads/${uploadId}`);
  expect(mocks.upload).toHaveBeenCalledBefore(mocks.rpc);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "send_chat_message",
    expect.objectContaining({
      p_image: {
        objectId: expect.any(String),
        fileName: "photo.png",
        mimeType: "image/png",
        byteSize: mocks.upload.mock.calls[0][1].byteLength,
        width: 10,
        height: 20,
      },
    }),
  );
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([
    `owner/chat-uploads/${uploadId}`,
  ]);
});

it("rejects corrupt staged image data without queueing a turn", async () => {
  mocks.download.mockResolvedValue({ data: new Blob(["bad"]), error: null });
  const response = await POST(
    request({
      conversationId,
      messageId,
      message: "Describe this image.",
      image: {
        uploadId: "00000000-0000-4000-8000-000000000003",
        fileName: "photo.png",
        mimeType: "image/png",
        byteSize: 3,
      },
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it("signs only supported image uploads in the authenticated owner's staging folder", async () => {
  const metadata = {
    fileName: "photo.png",
    mimeType: "image/png",
    byteSize: 123,
  };
  mocks.auth.mockRejectedValueOnce(new ApiError("Sign in required.", 401));
  expect((await signUpload(request(metadata))).status).toBe(401);
  expect(
    (await signUpload(request({ ...metadata, mimeType: "image/svg+xml" })))
      .status,
  ).toBe(400);
  expect(mocks.signUpload).not.toHaveBeenCalled();

  mocks.signUpload.mockResolvedValue({
    data: { token: "signed-upload" },
    error: null,
  });
  const response = await signUpload(request({ ...metadata, path: "ignored" }));
  expect(response.status).toBe(201);
  const { uploadId, path, token } = await response.json();
  expect(path).toBe(`owner/chat-uploads/${uploadId}`);
  expect(mocks.signUpload).toHaveBeenCalledExactlyOnceWith(path);
  expect(token).toBe("signed-upload");
});
