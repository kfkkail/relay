import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RelayHeader } from "./relay-header";
import { VehicleCard, VehicleEditor } from "./vehicles";
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
      else expect(actions).not.toContain("Verify");
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
    expect(html).toMatch(/<option value="quad"[^>]*>Quad<\/option>/);
    expect(html).toContain('<option value="tri">Tri</option>');
  });
});
