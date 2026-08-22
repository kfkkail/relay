import { describe, expect, it } from "vitest";
import {
  defaultDeliverable,
  deliverableConflict,
  parseDeliverable,
  parseDeliverableUpdate,
} from "./deliverables";

describe("deliverables", () => {
  it("defaults missing values for older clients", () => {
    expect(parseDeliverable(undefined)).toBe(defaultDeliverable);
  });

  it("rejects unknown values", () => {
    expect(() => parseDeliverable("ship_it")).toThrow("valid deliverable");
  });

  it("preserves stored values when older clients omit deliverable updates", () => {
    expect(parseDeliverableUpdate(undefined)).toBeUndefined();
    expect(parseDeliverableUpdate("proposal")).toBe("proposal");
    expect(() => parseDeliverableUpdate("ship_it")).toThrow(
      "valid deliverable",
    );
  });

  it("surfaces contradictory pull-request instructions", () => {
    expect(
      deliverableConflict("proposal", "Please create a PR with the result."),
    ).toContain("does not permit");
    expect(
      deliverableConflict("implementation_pr", "Do not modify product code."),
    ).toContain("requires code changes");
    expect(
      deliverableConflict("investigation", "Diagnose and report the cause."),
    ).toBeNull();
  });

  it("allows scoped implementation constraints", () => {
    expect(
      deliverableConflict(
        "implementation_pr",
        "Implement the feature, but do not change the public API.",
      ),
    ).toBeNull();
    expect(
      deliverableConflict(
        "implementation_pr",
        "Fix the bug without changing the database schema.",
      ),
    ).toBeNull();
  });
});
