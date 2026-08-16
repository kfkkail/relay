import { afterEach, describe, expect, it } from "vitest";
import {
  hasPublicSupabaseConfig,
  requirePublicSupabaseConfig,
  requireOwnerGitHubId,
  requireServerSupabaseConfig,
} from "./env";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Supabase integration environment", () => {
  it("uses the native variables synchronized by the Vercel integration", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_example";
    process.env.RELAY_OWNER_GITHUB_ID = "123456";

    expect(hasPublicSupabaseConfig()).toBe(true);
    expect(requirePublicSupabaseConfig()).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_example",
    });
    expect(requireServerSupabaseConfig()).toEqual({
      url: "https://example.supabase.co",
      secretKey: "sb_secret_example",
    });
    expect(requireOwnerGitHubId()).toBe("123456");
  });

  it("rejects a missing or non-numeric owner GitHub ID", () => {
    delete process.env.RELAY_OWNER_GITHUB_ID;
    expect(() => requireOwnerGitHubId()).toThrow("RELAY_OWNER_GITHUB_ID");
    process.env.RELAY_OWNER_GITHUB_ID = "not-a-number";
    expect(() => requireOwnerGitHubId()).toThrow("numeric GitHub user ID");
  });
});
