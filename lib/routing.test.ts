import { describe, expect, it } from "vitest";
import { parseMyWorkFilter, parseTaskFilter, safeReturnPath } from "./routing";

describe("route parsing", () => {
  it("accepts supported filters and falls back for unknown values", () => {
    expect(parseTaskFilter("waiting")).toBe("waiting");
    expect(parseTaskFilter("unknown")).toBe("inbox");
    expect(parseMyWorkFilter("snoozed")).toBe("snoozed");
    expect(parseMyWorkFilter(undefined)).toBe("active");
  });

  it("allows local sign-in return paths only", () => {
    expect(safeReturnPath("/tasks/123?status=waiting")).toBe(
      "/tasks/123?status=waiting",
    );
    expect(safeReturnPath("https://evil.example/tasks")).toBe("/tasks");
    expect(safeReturnPath("//evil.example/tasks")).toBe("/tasks");
    expect(safeReturnPath(null)).toBe("/tasks");
  });
});
