import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
import Preview from "@/app/vehicles/preview/page";
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "0", "1"])(
  "never exposes the sample in production, even with preview flag %s",
  (flag) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RELAY_VEHICLES_PREVIEW", flag);
    expect(() => Preview()).toThrow("not-found");
  },
);
it("requires an explicit local-development opt-in", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RELAY_VEHICLES_PREVIEW", undefined);
  expect(() => Preview()).toThrow("not-found");
  vi.stubEnv("RELAY_VEHICLES_PREVIEW", "1");
  expect(Preview()).toBeTruthy();
});
