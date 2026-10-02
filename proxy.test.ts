import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";
import nextConfig from "./next.config";

describe("proxy matcher", () => {
  it("does not run session middleware for bearer-authenticated worker APIs", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig,
        url: "/api/worker/runs/claim",
      }),
    ).toBe(false);
  });

  it("continues to run session middleware for browser and user API routes", () => {
    for (const url of ["/tasks", "/api/tasks", "/api/workers"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(
        true,
      );
    }
  });
});
