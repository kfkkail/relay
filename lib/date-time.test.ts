import { describe, expect, it } from "vitest";
import { localDateTimeToUtc, utcToLocalDateTime } from "./date-time";

describe("owner action date-time conversion", () => {
  it("stores an Eastern local time as UTC", () => {
    expect(localDateTimeToUtc("2026-08-18T07:00", 240)).toBe("2026-08-18T11:00:00.000Z");
  });

  it("restores a UTC time for an Eastern date-time input", () => {
    expect(utcToLocalDateTime("2026-08-18T11:00:00.000Z", 240)).toBe("2026-08-18T07:00");
  });
});
