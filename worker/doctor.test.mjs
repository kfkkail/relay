import { describe, expect, it, vi } from "vitest";
import { diagnoseWorker, redactDiagnostic } from "./doctor.mjs";

describe("worker diagnostic probe", () => {
  const env = {
    RELAY_WORKER_BACKEND: "codex",
    RELAY_CODEX_PATH: "/opt/bin/codex",
    RELAY_CODEX_WORKSPACE: "/worker/projects",
    RELAY_CODEX_MODEL: "gpt-custom",
    RELAY_CODEX_ADDITIONAL_WRITABLE_DIRS: "/worker/tool-state",
    RELAY_COMMAND_PATH: "/opt/bin:/usr/bin",
    RELAY_WORKER_TOKEN: "relay_super_private_token",
  };
  const exec = vi.fn(async () => ({ stdout: "codex-cli 0.167.0\n" }));

  it("uses production launch settings and a fixed probe rather than a user task", async () => {
    const runCodex = vi.fn(async () => ({
      resultMarkdown: "Relay worker ready",
      documents: [],
    }));
    const report = await diagnoseWorker(env, { exec, runCodex });
    expect(report).toEqual({
      ok: true,
      version: "codex-cli 0.167.0",
      model: "gpt-custom",
    });
    expect(exec).toHaveBeenCalledWith(
      "/opt/bin/codex",
      ["--version"],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: "/opt/bin:/usr/bin" }),
      }),
    );
    const [input, options] = runCodex.mock.calls[0];
    expect(input).toContain("Do not use tools");
    expect(options).toMatchObject({
      command: env.RELAY_CODEX_PATH,
      workspace: env.RELAY_CODEX_WORKSPACE,
      model: "gpt-custom",
      additionalDirectories: env.RELAY_CODEX_ADDITIONAL_WRITABLE_DIRS,
      timeoutMs: 30_000,
    });
  });

  it("reports a redacted startup error without credentials or progress text", async () => {
    const runCodex = async (_input, { onDiagnostic }) => {
      onDiagnostic({
        stderr: `progress text\nError: read-only state, secret=${env.RELAY_WORKER_TOKEN}`,
      });
      throw new Error("Codex CLI cannot write its local state or workspace.");
    };
    const report = await diagnoseWorker(env, { exec, runCodex });
    expect(report.ok).toBe(false);
    expect(report.error).toContain("cannot write");
    expect(report.diagnostic).toContain("Error: read-only state");
    expect(JSON.stringify(report)).not.toContain(env.RELAY_WORKER_TOKEN);
    expect(report.diagnostic).not.toContain("progress text");
  });

  it("does not require a model override and still diagnoses a missing executable", async () => {
    const report = await diagnoseWorker(
      { RELAY_WORKER_BACKEND: "codex" },
      {
        exec: async () => {
          throw new Error("missing");
        },
        runCodex: async () => {
          throw new Error("Codex CLI is unavailable at RELAY_CODEX_PATH.");
        },
      },
    );
    expect(report).toMatchObject({
      ok: false,
      version: "unavailable",
      model: "Codex CLI default",
      error: expect.stringContaining("unavailable"),
    });
  });

  it("does not use the API backend or silently change models", async () => {
    const runCodex = vi.fn();
    expect(await diagnoseWorker({}, { exec, runCodex })).toMatchObject({
      ok: false,
      error: expect.stringContaining("requires RELAY_WORKER_BACKEND=codex"),
    });
    expect(runCodex).not.toHaveBeenCalled();
  });

  it("redacts env secrets, tokens, and authenticated URL components", () => {
    const result = redactDiagnostic(
      "Error: key=custom-secret Bearer bearer-value sk-abcdef ghp_abcdef eyJabc.def.ghi https://user:password@example.com/path?token=secret#token",
      { CUSTOM_SECRET: "custom-secret" },
    );
    for (const value of [
      "custom-secret",
      "bearer-value",
      "sk-abcdef",
      "ghp_abcdef",
      "eyJabc.def.ghi",
      "user:password",
      "?token",
      "#token",
    ])
      expect(result).not.toContain(value);
    expect(result).toContain("https://example.com/path");
  });
});
