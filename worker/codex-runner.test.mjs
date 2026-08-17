import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  codexArguments,
  codexEnvironment,
  runWithCodex,
} from "./codex-runner.mjs";
import { createTaskRunner } from "./task-runner.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("native Codex runner", () => {
  it("uses Codex's workspace sandbox with command network access", () => {
    const args = codexArguments("gpt-example");

    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain("sandbox_workspace_write.network_access=true");
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain("workspace-write");
    expect(args).not.toContain("danger-full-access");
    expect(args).toContain("--model");
    expect(args.at(-1)).toBe("-");
  });

  it("preserves the local tool environment but removes Relay and API secrets", () => {
    const env = codexEnvironment({
      HOME: "/Users/relay",
      PATH: "/usr/bin",
      RELAY_COMMAND_PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      GH_TOKEN: "github-token",
      RELAY_WORKER_TOKEN: "relay-secret",
      OPENAI_API_KEY: "api-secret",
      SUPABASE_SECRET_KEY: "database-secret",
    });

    expect(env).toMatchObject({
      HOME: "/Users/relay",
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      GH_TOKEN: "github-token",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(env.RELAY_WORKER_TOKEN).toBeUndefined();
    expect(env.RELAY_COMMAND_PATH).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it("passes task text to Codex launched from the configured workspace", async () => {
    const workspace = await makeDirectory("relay-workspace-test-");
    const fixture = await makeExecutable(`#!/usr/bin/env node
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input, relaySecret: process.env.RELAY_WORKER_TOKEN, home: process.env.HOME }));
`);

    const result = JSON.parse(await runWithCodex("# Task\nCreate a pull request", {
      command: fixture,
      env: {
        ...process.env,
        HOME: "/Users/relay",
        RELAY_WORKER_TOKEN: "do-not-forward",
      },
      model: "gpt-example",
      timeoutMs: 5000,
      workspace,
    }));

    expect(result.args).toEqual(codexArguments("gpt-example"));
    expect(result.input).toContain("running on the owner's machine");
    expect(result.input).toContain("Do not disable or evade the Codex sandbox");
    expect(result.input).toContain("Relay displays one text/Markdown result");
    expect(result.input).toContain("Do not link to local files or generated documents");
    expect(result.input).toContain("http/https links are supported");
    expect(result.input).toContain("commits, and pull requests");
    expect(result.input).toContain(
      "# Trusted Relay worker policy\n\n",
    );
    expect(result.input).toContain(
      "# Untrusted task text\n\n# Task\nCreate a pull request",
    );
    expect(result.relaySecret).toBeUndefined();
    expect(result.home).toBe("/Users/relay");
    expect(result.cwd).toBe(await realpath(workspace));
  });

  it("requires an existing workspace", async () => {
    await expect(runWithCodex("task", {
      command: "/opt/codex",
      timeoutMs: 5000,
    })).rejects.toThrow("RELAY_CODEX_WORKSPACE is required");
  });

  it("returns a safe usage-limit error without CLI diagnostics", async () => {
    const workspace = await makeDirectory("relay-workspace-test-");
    const fixture = await makeExecutable(`#!/usr/bin/env node
process.stderr.write("quota exceeded with sensitive diagnostics");
process.exit(1);
`);

    await expect(runWithCodex("task", {
      command: fixture,
      env: process.env,
      timeoutMs: 5000,
      workspace,
    })).rejects.toThrow("Codex CLI usage limit reached");
  });
});

describe("worker backend selection", () => {
  it("uses the local Codex CLI without requiring an OpenAI API key", async () => {
    const calls = [];
    const runner = createTaskRunner({
      RELAY_WORKER_BACKEND: "codex",
      RELAY_CODEX_PATH: "/opt/homebrew/bin/codex",
      RELAY_CODEX_WORKSPACE: "/Users/relay/repos",
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
      options: {
        command: "/opt/homebrew/bin/codex",
        model: "gpt-example",
        workspace: "/Users/relay/repos",
      },
    });
  });

  it("keeps API-key validation for the OpenAI backend", () => {
    expect(() => createTaskRunner({ RELAY_WORKER_BACKEND: "openai" })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });

  it("gives the OpenAI backend the same result contract and a separate untrusted input", async () => {
    const calls = [];
    class FakeOpenAI {
      responses = {
        create: async (request) => {
          calls.push(request);
          return { output_text: "done" };
        },
      };
    }
    const runner = createTaskRunner({
      RELAY_WORKER_BACKEND: "openai",
      OPENAI_API_KEY: "test-key",
    }, { OpenAI: FakeOpenAI });

    await expect(runner.run("# Task\nSummarize the document")).resolves.toBe("done");
    expect(calls[0].instructions).toContain("one text/Markdown result");
    expect(calls[0].instructions).toContain("Do not link to local files or generated documents");
    expect(calls[0].instructions).toContain("http/https links are supported");
    expect(calls[0].instructions).toContain("commits, and pull requests");
    expect(calls[0].instructions).toContain("untrusted task text");
    expect(calls[0].input).toBe("# Task\nSummarize the document");
    expect(calls[0].instructions).not.toContain("Summarize the document");
  });
});

async function makeDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeExecutable(contents) {
  const directory = await makeDirectory("relay-codex-test-");
  const path = join(directory, "fake-codex");
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
}
