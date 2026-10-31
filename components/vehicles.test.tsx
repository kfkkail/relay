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
  shouldQueueVehicleEnrichment,
} from "./vehicles";
import { createVehiclePreviewRequest } from "@/lib/vehicles/preview";
import { defaultVehicleProfile } from "@/lib/vehicles/domain";
import { reviewVehicle } from "@/lib/vehicles/review";
import type { Decision } from "@/lib/vehicles/types";

describe("Relay Vehicles presentation", () => {
  it("shows the seller denial and keeps manual retry available", async () => {
    const data = await (
      await createVehiclePreviewRequest()("/api/vehicles")
    ).json();
    const vehicle = reviewVehicle(
      {
        ...data.vehicles[0],
        decision: "watch",
        enrichment: {
          status: "blocked",
          failure: {
            code: "access_denied",
            host: "www.carvana.com",
            http_status: 403,
          },
        },
      },
      defaultVehicleProfile,
    )!;
    const html = renderToStaticMarkup(
      <VehicleCard
        vehicle={vehicle}
        busy={false}
        decide={() => {}}
        verify={() => {}}
        gallery={() => {}}
        enrich={() => {}}
      />,
    );
    expect(html).toContain("Seller blocked the configuration check");
    expect(html).toContain("www.carvana.com");
    expect(html).toContain("HTTP 403");
    expect(html).toContain("Check battery &amp; motor");
  });
  it("offers manual checks for existing Interested vehicles and queues missing configuration on review", async () => {
    const data = await (
      await createVehiclePreviewRequest()("/api/vehicles")
    ).json();
    const record = data.vehicles[0];
    record.vehicle_listings[0].data.attributes = {
      battery_pack: null,
      motor: null,
      battery_evidence: null,
    };
    const initial = reviewVehicle(record, defaultVehicleProfile)!;
    expect(shouldQueueVehicleEnrichment(initial, "watch", false)).toBe(true);
    expect(shouldQueueVehicleEnrichment(initial, "shortlist", false)).toBe(
      true,
    );
    expect(shouldQueueVehicleEnrichment(initial, "passed", false)).toBe(false);
    expect(shouldQueueVehicleEnrichment(initial, "watch", true)).toBe(false);
    const interested = { ...initial, decision: "watch" as const };
    const html = renderToStaticMarkup(
      <VehicleCard
        vehicle={interested}
        busy={false}
        decide={() => {}}
        verify={() => {}}
        gallery={() => {}}
        enrich={() => {}}
      />,
    );
    expect(html).toContain("Check battery &amp; motor");
    expect(shouldQueueVehicleEnrichment(interested, "watch", false)).toBe(
      false,
    );
    const queued = { ...interested, enrichment: { status: "queued" as const } };
    const queuedHtml = renderToStaticMarkup(
      <VehicleCard
        vehicle={queued}
        busy={false}
        decide={() => {}}
        verify={() => {}}
        gallery={() => {}}
        enrich={() => {}}
      />,
    );
    expect(queuedHtml).toContain("Check queued");
    expect(shouldQueueVehicleEnrichment(queued, "shortlist", false)).toBe(
      false,
    );
  });
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
  it.each([false, true])(
    "provides one header editor for every sample listing (busy=%s)",
    async (busy) => {
      const data = await (
        await createVehiclePreviewRequest()("/api/vehicles")
      ).json();
      for (const record of data.vehicles) {
        const vehicle = reviewVehicle(record, defaultVehicleProfile)!;
        const html = renderToStaticMarkup(
          <VehicleCard
            vehicle={vehicle}
            busy={busy}
            decide={() => {}}
            verify={() => {}}
            gallery={() => {}}
          />,
        );
        expect(html.match(/class="vehicle-edit-button"/g)).toHaveLength(1);
        const header = html.slice(
          html.indexOf('class="vehicle-card-title"'),
          html.indexOf('class="vehicle-configuration"'),
        );
        expect(header).toContain('aria-label="Edit and verify ');
        expect(header).toContain('title="Edit price &amp; verify details"');
        expect(header.includes('disabled=""')).toBe(busy);
        expect(html).not.toMatch(/>\s*(Edit price|Verify)\s*</);
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
    expect(html).toContain(
      "Asking price (leave blank to use the listing price)",
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
    expect(html).toContain('class="vehicle-gallery-track"');
    expect(html.match(/class="vehicle-gallery-slide"/g)).toHaveLength(5);
    expect(html.match(/loading="eager"/g)).toHaveLength(5);
    expect(html).toContain("Adjacent listing photo");
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
