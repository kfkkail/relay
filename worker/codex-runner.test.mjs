import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexArguments, codexEnvironment, runWithCodex } from "./codex-runner.mjs";
import { createTaskRunner } from "./task-runner.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex CLI runner", () => {
  it("uses an allowlisted workspace with command network access", () => {
    const args = codexArguments("gpt-example");

    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain('approval_policy="never"');
    expect(args).not.toContain("approvals_reviewer");
    expect(args).not.toContain(":danger-full-access");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('default_permissions="relay-workspace"');
    expect(args).toContain(
      'permissions.relay-workspace.filesystem={":root"="deny", ":minimal"="read", "/opt/homebrew"="read", "/usr/local"="read", "/Library/Developer/CommandLineTools"="read", "/Applications/Xcode.app"="read", "~/.config/gh"="read", "~/.gitconfig"="read", "~/.config/git"="read", ":tmpdir"="write", ":slash_tmp"="write", ":workspace_roots"={"."="write", "**/.env"="deny", "**/.env.*"="deny"}}',
    );
    expect(args).toContain("permissions.relay-workspace.network.enabled=true");
    expect(args).toContain("--model");
    expect(args.at(-1)).toBe("-");
  });

  it("does not expose Relay or API credentials to Codex commands", () => {
    const env = codexEnvironment({
      HOME: "/home/relay",
      PATH: "/usr/bin",
      RELAY_WORKER_TOKEN: "relay-secret",
      OPENAI_API_KEY: "api-secret",
      CODEX_API_KEY: "codex-secret",
      SUPABASE_SECRET_KEY: "database-secret",
      HTTPS_PROXY: "https://proxy-user:proxy-secret@example.com",
      RELAY_GITHUB_TOKEN: "github-token",
    });

    expect(env).toEqual({
      HOME: "/home/relay",
      PATH: "/usr/bin",
      GIT_TERMINAL_PROMPT: "0",
      GH_TOKEN: "github-token",
    });
  });

  it("passes task text over stdin and runs from the configured workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "relay-workspace-test-"));
    temporaryDirectories.push(workspace);
    const fixture = await makeExecutable(`#!/usr/bin/env node
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input, secret: process.env.RELAY_WORKER_TOKEN }));
`);

    const result = JSON.parse(await runWithCodex("# Task\nWrite a summary", {
      command: fixture,
      env: { ...process.env, RELAY_WORKER_TOKEN: "do-not-forward" },
      timeoutMs: 5000,
      workspace,
    }));

    expect(result.input).toContain("Relay's local software task worker");
    expect(result.input).toContain("Never request or use access outside the configured workspace");
    expect(result.input).toContain("# Task\nWrite a summary");
    expect(result.secret).toBeUndefined();
    expect(result.cwd).toBe(await realpath(workspace));
  });

  it("requires an existing configured workspace", async () => {
    await expect(runWithCodex("task", {
      command: "/opt/codex",
      timeoutMs: 5000,
    })).rejects.toThrow("RELAY_CODEX_WORKSPACE is required");
  });

  it("returns a safe usage-limit error without model diagnostics", async () => {
    const fixture = await makeExecutable(`#!/usr/bin/env node
process.stderr.write("quota exceeded with sensitive diagnostics");
process.exit(1);
`);

    await expect(runWithCodex("task", {
      command: fixture,
      env: process.env,
      timeoutMs: 5000,
      workspace: process.cwd(),
    })).rejects.toThrow("Codex CLI usage limit reached");
  });
});

describe("worker backend selection", () => {
  it("uses Codex without requiring an OpenAI API key", async () => {
    const calls = [];
    const runner = createTaskRunner({
      RELAY_WORKER_BACKEND: "codex",
      RELAY_CODEX_PATH: "/opt/codex",
      RELAY_CODEX_WORKSPACE: "/srv/repos",
      RELAY_CODEX_MODEL: "gpt-example",
    }, {
      runCodex: async (input, options) => {
        calls.push({ input, options });
        return "done";
      },
    });

    await expect(runner.run("task input")).resolves.toBe("done");
    expect(calls[0]).toMatchObject({
      input: "task input",
      options: { command: "/opt/codex", model: "gpt-example", workspace: "/srv/repos" },
    });
  });

  it("keeps API-key validation for the OpenAI backend", () => {
    expect(() => createTaskRunner({ RELAY_WORKER_BACKEND: "openai" })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });
});

async function makeExecutable(contents) {
  const directory = await mkdtemp(join(tmpdir(), "relay-codex-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "fake-codex");
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
}
