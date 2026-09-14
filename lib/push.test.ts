import { describe, expect, it } from "vitest";
import { pushPayload, pushStatus, validateSubscription } from "./push";

const keys = {
  p256dh: Buffer.alloc(65, 1).toString("base64url"),
  auth: Buffer.alloc(16, 2).toString("base64url"),
};

describe("push subscriptions", () => {
  it.each([
    "https://web.push.apple.com/token",
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
  ])("accepts browser endpoint %s", (endpoint) => {
    expect(validateSubscription({ endpoint, keys })).toEqual({
      endpoint,
      keys,
    });
  });
  it.each([
    "http://web.push.apple.com/token",
    "https://web.push.apple.com.evil.test/token",
    "https://127.0.0.1/token",
    "https://localhost/token",
    "https://web.push.apple.com:444/token",
    "https://user:pass@web.push.apple.com/token",
    "not a url",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => validateSubscription({ endpoint, keys })).toThrow();
  });
  it("rejects malformed encryption keys", () => {
    expect(() =>
      validateSubscription({
        endpoint: "https://web.push.apple.com/token",
        keys: { ...keys, auth: "short" },
      }),
    ).toThrow();
  });
});

it("uses generic copy and an existing task route", () => {
  const payload = JSON.parse(
    pushPayload("completed", "task-id", "delivery-id"),
  );
  expect(payload).toMatchObject({
    title: "Result ready to review",
    url: "/tasks/task-id",
    tag: "relay-delivery-id",
  });
  expect(JSON.parse(pushPayload("failed")).title).toBe("Run needs attention");
});
it("classifies provider errors without exposing their contents", () => {
  expect(pushStatus({ statusCode: 410, body: "secret" })).toBe(410);
  expect(pushStatus(new Error("network failure"))).toBe(0);
});
