import { describe, expect, it } from "vitest";
import { codexFailure } from "./codex-runner.mjs";

describe("Codex failure categories", () => {
  it.each([
    [
      "Error: Your refresh token has expired",
      "authentication failed or expired",
    ],
    ["ERROR: 401 Unauthorized", "authentication failed or expired"],
    [
      "Error: The 'gpt-6.2-sol' model is not supported when using Codex with a ChatGPT account.",
      "cannot use the configured model",
    ],
    ["Error: model_not_found", "cannot use the configured model"],
    [
      "Error: You do not have access to the model",
      "cannot use the configured model",
    ],
    [
      "error: unexpected argument '--ignore-rules' found",
      "does not support Relay's launch options",
    ],
    [
      "Error: failed to initialize in-process app-server client: Read-only file system (os error 30)",
      "cannot write its local state or workspace",
    ],
    [
      "Error: Permission denied (os error 13)",
      "cannot write its local state or workspace",
    ],
    [
      "Error: No space left on device (os error 28)",
      "ran out of local disk space",
    ],
    ["Error loading config: TOML parse error", "rejected its configuration"],
    [
      "Error: unsupported parameter model_reasoning_effort",
      "rejected its configuration",
    ],
    ["Error: quota exceeded", "usage limit reached"],
    ["Error: maximum context length exceeded", "context limit"],
    [
      "Error: stream disconnected before completion",
      "could not maintain its connection",
    ],
    ["Error: failed to connect to server", "could not maintain its connection"],
  ])("classifies %s without exposing raw diagnostics", (stderr, category) => {
    const result = codexFailure(`${stderr}\nsecret=private-credential`, 1);
    expect(result).toContain(category);
    expect(result).not.toContain("private-credential");
  });

  it("distinguishes process termination from an exit code", () => {
    expect(codexFailure("", null, "SIGKILL")).toContain(
      "terminated by SIGKILL",
    );
  });

  it("gives unknown failures a reproducible diagnostic command", () => {
    expect(codexFailure("private diagnostics", 1)).toBe(
      "Codex CLI exited with status 1. Run npm run worker:doctor from the managed worker checkout for a safe startup diagnostic.",
    );
  });
});
