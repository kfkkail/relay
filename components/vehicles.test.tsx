import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RelayHeader } from "./relay-header";
import {
  VehicleCard,
  VehicleEditor,
  VehicleGalleryViewer,
  gallerySwipeDirection,
  shouldPrefetchVehiclePhotos,
  shouldQueueVehiclePhotos,
} from "./vehicles";
import { createVehiclePreviewRequest } from "@/lib/vehicles/preview";
import { defaultVehicleProfile } from "@/lib/vehicles/domain";
import { reviewVehicle } from "@/lib/vehicles/review";
import type { Decision } from "@/lib/vehicles/types";

describe("Relay Vehicles presentation", () => {
  it("shares Relay branding and navigation without a top-level Vehicles slot", () => {
    const html = renderToStaticMarkup(
      <RelayHeader userEmail="sample@relay.local" active="schedules" />,
    );
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/my-work"');
    expect(html).toContain('href="/tasks"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/schedules"/);
    const navigation = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(navigation).not.toContain('href="/vehicles"');
  });
  it("disables global account actions in the isolated sample", () => {
    const html = renderToStaticMarkup(
      <RelayHeader userEmail="sample@relay.local" preview />,
    );
    expect(html).toContain(
      'aria-label="Account settings unavailable in sample"',
    );
    expect(html).not.toContain("/auth/sign-out");
    expect(html).not.toContain("Notification settings");
  });
  it.each(["unreviewed", "passed"] as Decision[])(
    "keeps %s review actions focused and secondary data in details",
    async (decision) => {
      const data = await (
        await createVehiclePreviewRequest()("/api/vehicles")
      ).json();
      const record = { ...data.vehicles[0], decision };
      const vehicle = reviewVehicle(record, defaultVehicleProfile)!;
      const html = renderToStaticMarkup(
        <VehicleCard
          vehicle={vehicle}
          busy={false}
          decide={() => {}}
          verify={() => {}}
          gallery={() => {}}
        />,
      );
      expect(html).toContain('class="vehicle-details"');
      expect(html).toContain("Details &amp; sources");
      expect(html).toContain("With shipping &amp; fees");
      expect(html).toContain('draggable="false"');
      const actions = html.slice(
        html.indexOf('class="vehicle-actions vehicle-review-actions"'),
      );
      expect(actions.match(/<button/g)).toHaveLength(
        decision === "passed" ? 1 : 3,
      );
      if (decision === "passed")
        expect(actions).toContain("Restore to Unreviewed");
      else {
        expect(actions).not.toContain("Verify");
        expect(actions).toContain("Interested");
        expect(actions).not.toContain(">Watch<");
      }
    },
  );
  it("offers the normalized battery and motor choices", async () => {
    const data = await (
      await createVehiclePreviewRequest()("/api/vehicles")
    ).json();
    const vehicle = reviewVehicle(data.vehicles[0], defaultVehicleProfile)!;
    const html = renderToStaticMarkup(
      <VehicleEditor
        vehicle={vehicle}
        config={defaultVehicleProfile}
        busy={false}
        close={() => {}}
        save={async () => {}}
      />,
    );
    expect(html).toContain("Confirmed battery pack (required)");
    expect(html).toContain('<option value="standard">Standard</option>');
    expect(html).toContain('<option value="standard+">Standard+</option>');
    expect(html).toMatch(/<option value="large"[^>]*>Large<\/option>/);
    expect(html).toContain('<option value="max">Max</option>');
    expect(html).toContain("Confirmed motor configuration (optional)");
    expect(html).toContain('<option value="dual">Dual</option>');
    expect(html).toContain(
      '<option value="performance dual">Performance Dual / Dual + Power Upgrade</option>',
    );
    expect(html).toMatch(/<option value="quad"[^>]*>Quad<\/option>/);
    expect(html).toContain('<option value="tri">Tri</option>');
  });
  it("queues fuller galleries only for live Interested and Shortlist vehicles", () => {
    const vehicle = {
      vin: "7FCTGAAA0NN000001",
      row: {
        source: "auto.dev" as const,
        photo_count: 12,
        gallery_fetched_at: null,
        photos: [
          {
            url: "https://example.test/main.jpg",
            category: "exterior" as const,
          },
        ],
      },
    };
    expect(shouldQueueVehiclePhotos(vehicle, "watch", false)).toBe(true);
    expect(shouldQueueVehiclePhotos(vehicle, "shortlist", false)).toBe(true);
    expect(shouldQueueVehiclePhotos(vehicle, "unreviewed", false)).toBe(false);
    expect(shouldQueueVehiclePhotos(vehicle, "watch", true)).toBe(false);
    expect(shouldPrefetchVehiclePhotos(vehicle, false)).toBe(true);
    expect(
      shouldPrefetchVehiclePhotos(
        {
          ...vehicle,
          row: {
            ...vehicle.row,
            gallery_fetched_at: "2026-10-29T14:00:00Z",
          },
        },
        false,
      ),
    ).toBe(false);
    expect(
      shouldQueueVehiclePhotos({ ...vehicle, vin: null }, "shortlist", false),
    ).toBe(false);
    expect(
      shouldQueueVehiclePhotos(
        { ...vehicle, row: { ...vehicle.row, photo_count: 1 } },
        "watch",
        false,
      ),
    ).toBe(false);
  });
  it("uses one focused gallery viewer instead of an action under every image", async () => {
    const data = await (
      await createVehiclePreviewRequest()("/api/vehicles")
    ).json();
    const vehicle = reviewVehicle(data.vehicles[0], defaultVehicleProfile)!;
    const gallery = {
      ...vehicle.row,
      vehicleId: vehicle.id,
      photos: [
        ...vehicle.row.photos,
        {
          url: "https://example.test/third.jpg",
          category: "unknown" as const,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <VehicleGalleryViewer
        gallery={gallery}
        index={1}
        busy={false}
        preview
        canLoad={false}
        close={() => {}}
        previous={() => {}}
        next={() => {}}
        loadPhotos={() => {}}
        selectInterior={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain('aria-label="Next photo"');
    expect(html.indexOf('aria-label="Previous photo"')).toBeGreaterThan(
      html.indexOf('class="vehicle-gallery-footer"'),
    );
    expect(html).toContain("2 of 3");
    expect(html).toContain("Swipe or use arrow keys");
    expect(html.match(/aria-pressed=/g)).toHaveLength(1);
    expect(html).toContain("Interior selected");
    expect(html).toContain("Load gallery");
    expect(html).toContain("Live gallery loading is disabled in the sample.");
    expect(html).not.toContain("Use as interior photo");
  });
  it("changes gallery photos only for deliberate horizontal swipes", () => {
    expect(gallerySwipeDirection(200, 100, 100, 105)).toBe(1);
    expect(gallerySwipeDirection(100, 100, 200, 95)).toBe(-1);
    expect(gallerySwipeDirection(100, 100, 130, 100)).toBe(0);
    expect(gallerySwipeDirection(100, 100, 160, 180)).toBe(0);
  });
});
