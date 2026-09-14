import { expect, it } from "vitest";
import { deliveryUpdate } from "./push-delivery";
const now = Date.parse("2026-09-14T12:00:00Z");
it("records provider acceptance separately from failure, including on the last attempt", () => {
  expect(deliveryUpdate(201, 6, now)).toEqual({
    last_status_code: 201,
    delivered_at: new Date(now).toISOString(),
    finished_at: new Date(now).toISOString(),
  });
});
it.each([401, 403, 500, 0])(
  "persists an exhausted %s failure without recording delivery",
  (status) => {
    expect(deliveryUpdate(status, 6, now)).toEqual({
      last_status_code: status,
      failed_at: new Date(now).toISOString(),
      finished_at: new Date(now).toISOString(),
    });
  },
);
it("retains retryable failures and their status without marking them finished", () => {
  expect(deliveryUpdate(503, 2, now)).toEqual({
    last_status_code: 503,
    available_at: new Date(now + 240000).toISOString(),
  });
});
it.each([404, 410])(
  "records a permanent %s failure before removing the endpoint",
  (status) => {
    expect(deliveryUpdate(status, 1, now)).toHaveProperty("failed_at");
  },
);
it("stores only a bounded numeric status", () => {
  expect(deliveryUpdate(NaN, 6, now).last_status_code).toBe(0);
});
