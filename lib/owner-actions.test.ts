import { describe, expect, it } from "vitest";
import { futureOptionalDate, optionalDate, ownerActionDateUpdates } from "./owner-actions";

describe("owner action dates", () => {
  it("normalizes optional dates", () => {
    expect(optionalDate("2026-08-18T09:00:00-04:00", "Due date")).toBe("2026-08-18T13:00:00.000Z");
    expect(optionalDate("", "Due date")).toBeNull();
  });

  it("only accepts future snooze dates", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(futureOptionalDate("2026-08-19T12:00:00.000Z", "Snooze date", now)).toBe("2026-08-19T12:00:00.000Z");
    expect(() => futureOptionalDate("2026-08-17T12:00:00.000Z", "Snooze date", now)).toThrow("Snooze date must be in the future.");
    expect(futureOptionalDate(null, "Snooze date", now)).toBeNull();
  });

  it("does not allow hiding an action past its due date", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(() => ownerActionDateUpdates(
      { snoozedUntil: "2026-08-20T12:00:00.000Z" },
      "2026-08-19T12:00:00.000Z",
      now,
    )).toThrow("Hide until date cannot be after the due date.");
  });

  it("does not allow overdue actions to be hidden", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(() => ownerActionDateUpdates(
      { snoozedUntil: "2026-08-19T12:00:00.000Z" },
      "2026-08-17T12:00:00.000Z",
      now,
    )).toThrow("Overdue actions cannot be hidden.");
  });

  it("preserves the due date when hiding an action", () => {
    expect(ownerActionDateUpdates(
      { snoozedUntil: "2026-08-19T12:00:00.000Z" },
      "2026-08-20T12:00:00.000Z",
      new Date("2026-08-18T12:00:00.000Z"),
    )).toEqual({ snoozed_until: "2026-08-19T12:00:00.000Z" });
  });
});
