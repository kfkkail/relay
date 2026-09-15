import { expect, it } from "vitest";
import { authReturnPath } from "./auth-redirect";

it.each([
  "/my-work",
  "/schedules",
  "/tasks/123?from=%2Ftasks%3Fstatus%3Dwaiting",
  "/my-work/123#notes",
])("preserves a local dashboard destination: %s", (path) => {
  expect(authReturnPath(path)).toBe(path);
});
it.each([
  "https://evil.example/tasks",
  "//evil.example/tasks",
  "/\\evil.example/tasks",
  "/auth/callback",
  "/auth/sign-out",
  "/tasks-evil",
  undefined,
  {},
  "/tasks?x=" + "a".repeat(3000),
])("rejects external, auth, or oversized return paths", (path) => {
  expect(authReturnPath(path)).toBe("/my-work");
});
