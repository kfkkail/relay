import { beforeEach, expect, it, vi } from "vitest";
import { parseVehicleListing } from "./validation";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual("@/lib/http")),
  requireUser: async () => ({ supabase: mocks, user: { id: "owner" } }),
}));
import { POST } from "@/app/api/vehicles/route";

const id = "00000000-0000-4000-8000-000000000081";
const original = parseVehicleListing({
  source_listing_id: "7FCTGAAA0NN000001",
  vin: "7FCTGAAA0NN000001",
  make: "Rivian",
  model: "R1T",
  seller: "Dealer",
  seller_id: "dealer-1",
  url: "https://example.test/truck",
  photos: [{ url: "https://example.test/cabin.jpg", category: "unknown" }],
});
let current = original;
beforeEach(() => {
  vi.clearAllMocks();
  current = structuredClone(original);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.from.mockImplementation(() => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: vi.fn(async () => ({ data: { data: current }, error: null })),
    };
    return query;
  });
});
const request = (body: unknown) =>
  new Request("https://relay.example/api/vehicles", {
    method: "POST",
    body: JSON.stringify(body),
  });

it("stores only owner-confirmable facts and seller-scoped costs", async () => {
  const response = await POST(
    request({
      action: "verify",
      id,
      listing: {
        ...original,
        price: 50000,
        shipping: 0,
        mandatory_fees: 250,
        delivery: "pickup",
        decision: "passed",
        attributes: { battery_pack: "large", motor: "performance dual" },
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("verify_vehicle", {
    p_id: id,
    p_overrides: {
      attributes: {
        battery_pack: "large",
        motor: "performance dual",
        battery_evidence: null,
      },
      title_status: "unknown",
      history_available: false,
      history_flags: [],
      listing_verifications: {
        [`auto.dev:${original.vin}`]: {
          source: "auto.dev",
          source_listing_id: original.source_listing_id,
          seller: original.seller,
          seller_id: original.seller_id,
          url: original.url,
          price: 50000,
          shipping: 0,
          mandatory_fees: 250,
          delivery: "pickup",
        },
      },
    },
  });
});
it("rejects seller changes observed since the verification form opened", async () => {
  current.seller = "New seller";
  expect(
    (await POST(request({ action: "verify", id, listing: original }))).status,
  ).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("patches only the photo even when the gallery contains stale vehicle facts", async () => {
  expect(
    (
      await POST(
        request({
          action: "interior_photo",
          id,
          listing: { ...original, title_status: "clean", shipping: 0 },
          photoUrl: original.photos[0].url,
        }),
      )
    ).status,
  ).toBe(200);
  const patch = mocks.rpc.mock.calls[0][1].p_overrides;
  expect(Object.keys(patch)).toEqual(["listing_verifications"]);
  expect(patch.listing_verifications[`auto.dev:${original.vin}`]).toEqual({
    source: "auto.dev",
    source_listing_id: original.source_listing_id,
    seller: original.seller,
    seller_id: original.seller_id,
    url: original.url,
    interior_photo: original.photos[0].url,
  });
});
it("does not accept an arbitrary interior photo URL", async () => {
  expect(
    (
      await POST(
        request({
          action: "interior_photo",
          id,
          listing: original,
          photoUrl: "https://example.test/unknown.jpg",
        }),
      )
    ).status,
  ).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not freeze a known advertised price into a verification fallback", async () => {
  current.price = 51000;
  expect(
    (
      await POST(
        request({
          action: "verify",
          id,
          listing: { ...current, price: 50000 },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    mocks.rpc.mock.calls[0][1].p_overrides.listing_verifications[
      `auto.dev:${original.vin}`
    ],
  ).not.toHaveProperty("price");
});
it("queues one bounded gallery batch", async () => {
  const profileId = "00000000-0000-4000-8000-000000000082";
  expect(
    (await POST(request({ action: "photos_batch", ids: [id], profileId })))
      .status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("request_vehicle_photo_batch", {
    p_vehicles: [id],
    p_profile: profileId,
  });
});
it("rejects oversized requests without relying on Content-Length", async () => {
  expect(
    (await POST(request({ action: "verify", extra: "x".repeat(100001) })))
      .status,
  ).toBe(413);
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([null, [], "not an object"])(
  "rejects non-object JSON: %j",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  },
);
