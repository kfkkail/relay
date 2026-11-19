import { describe, expect, it, vi } from "vitest";
import { readRuntimeVersion, versionedFailure } from "./runtime-version.mjs";

describe("run error versions", () => {
  it("reads the configured executable version with the worker's command environment", async () => {
    const run = vi.fn(async () => "codex-cli 0.167.0-alpha.4\n");
    const info = await readRuntimeVersion(
      { command: "/worker/bin/codex", env: { PATH: "/worker/bin" } },
      run,
    );
    expect(run).toHaveBeenCalledWith("/worker/bin/codex", ["--version"], {
      env: { PATH: "/worker/bin" },
    });
    expect(info.codex).toBe("0.167.0-alpha.4");
    expect(info.relay).toMatch(/^(?:[a-f0-9]{7,40}|unknown)$/);
  });

  it("checks Codex again after an executable is upgraded", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("codex-cli 0.160.0")
      .mockResolvedValueOnce("codex-cli 0.167.0");
    expect((await readRuntimeVersion({ command: "codex" }, run)).codex).toBe(
      "0.160.0",
    );
    expect((await readRuntimeVersion({ command: "codex" }, run)).codex).toBe(
      "0.167.0",
    );
  });

  it("keeps unavailable version checks from hiding the original failure", async () => {
    const info = await readRuntimeVersion({ command: "missing" }, async () => {
      throw new Error("secret diagnostic");
    });
    const error = versionedFailure("Model unavailable.", info);
    expect(error).toContain("Model unavailable. [Codex unavailable; Relay ");
    expect(error).toContain("model CLI default]");
    expect(error).not.toContain("secret diagnostic");
  });

  it("ignores unexpected raw version output", async () => {
    const info = await readRuntimeVersion(
      { command: "codex" },
      async () => "secret raw diagnostics",
    );
    expect(info.codex).toBe("unknown");
  });

  it("includes explicit model selection without displaying malformed configuration", () => {
    expect(
      versionedFailure(
        "Failed.",
        { codex: "0.160.0", relay: "abc1234" },
        "gpt-example",
      ),
    ).toBe("Failed. [Codex 0.160.0; Relay abc1234; model gpt-example]");
    expect(
      versionedFailure(
        "Failed.",
        { codex: "unknown", relay: "unknown" },
        "secret\nconfiguration",
      ),
    ).not.toContain("secret");
  });
});
