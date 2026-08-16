import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  codexArguments,
  containerArguments,
  containerRuntimeEnvironment,
  runWithCodex,
} from "./codex-runner.mjs";
import { createTaskRunner } from "./task-runner.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex container runner", () => {
  it("mounts only the workspace and read-only Codex authentication", () => {
    const args = containerArguments({
      authFile: "/home/relay/.codex/auth.json",
      containerName: "relay-codex-test",
      environment: { GH_TOKEN: "github-token" },
      gid: 1000,
      image: "relay-codex-worker:test",
      model: "gpt-example",
      uid: 1000,
      workspace: "/srv/repos",
    });

    expect(args).toContain("--rm");
    expect(args).toContain("--interactive");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("/srv/repos:/workspace:rw");
    expect(args).toContain("/home/relay/.codex/auth.json:/home/relay/.codex/auth.json:ro");
    expect(args).toContain("GH_TOKEN");
    expect(args).not.toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(args).not.toContain("/:/host");
    expect(args).toContain("relay-codex-worker:test");
  });

  it("gives Codex normal command access only after the container boundary", () => {
    const args = codexArguments("gpt-example");

    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain("danger-full-access");
    expect(args.join(" ")).not.toContain("permissions.relay-");
    expect(args).toContain("--model");
    expect(args.at(-1)).toBe("-");
  });

  it("removes Relay and API credentials from the container runtime", () => {
    const env = containerRuntimeEnvironment({
      HOME: "/home/relay",
      PATH: "/usr/bin",
      RELAY_WORKER_TOKEN: "relay-secret",
      OPENAI_API_KEY: "api-secret",
      CODEX_API_KEY: "codex-secret",
      SUPABASE_SECRET_KEY: "database-secret",
      HTTPS_PROXY: "https://proxy-user:proxy-secret@example.com",
      RELAY_GITHUB_TOKEN: "github-token",
      RELAY_GIT_USER_NAME: "Relay Worker",
      RELAY_GIT_USER_EMAIL: "relay@example.com",
    });

    expect(env).toEqual({
      HOME: "/home/relay",
      PATH: "/usr/bin",
      GH_TOKEN: "github-token",
      GIT_AUTHOR_NAME: "Relay Worker",
      GIT_COMMITTER_NAME: "Relay Worker",
      GIT_AUTHOR_EMAIL: "relay@example.com",
      GIT_COMMITTER_EMAIL: "relay@example.com",
    });
  });

  it("passes task text through a runtime launched from the configured workspace", async () => {
    const workspace = await makeDirectory("relay-workspace-test-");
    const authDirectory = await makeDirectory("relay-auth-test-");
    const authFile = join(authDirectory, "auth.json");
    await writeFile(authFile, "{}");
    const fixture = await makeExecutable(`#!/usr/bin/env node
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input, relaySecret: process.env.RELAY_WORKER_TOKEN, githubToken: process.env.GH_TOKEN }));
`);

    const result = JSON.parse(await runWithCodex("# Task\nCreate a pull request", {
      authFile,
      command: fixture,
      env: {
        ...process.env,
        RELAY_GITHUB_TOKEN: "github-token",
        RELAY_WORKER_TOKEN: "do-not-forward",
      },
      image: "relay-codex-worker:test",
      timeoutMs: 5000,
      workspace,
    }));

    expect(result.input).toContain("Relay's local software task worker");
    expect(result.input).toContain("The disposable container is your machine");
    expect(result.input).toContain("# Task\nCreate a pull request");
    expect(result.relaySecret).toBeUndefined();
    expect(result.githubToken).toBe("github-token");
    expect(result.cwd).toBe(await realpath(workspace));
  });

  it("requires an existing workspace and authentication file", async () => {
    await expect(runWithCodex("task", {
      authFile: "/missing/auth.json",
      command: "/opt/docker",
      timeoutMs: 5000,
    })).rejects.toThrow("RELAY_CODEX_WORKSPACE is required");
  });

  it("returns a safe usage-limit error without container diagnostics", async () => {
    const workspace = await makeDirectory("relay-workspace-test-");
    const authDirectory = await makeDirectory("relay-auth-test-");
    const authFile = join(authDirectory, "auth.json");
    await writeFile(authFile, "{}");
    const fixture = await makeExecutable(`#!/usr/bin/env node
process.stderr.write("quota exceeded with sensitive diagnostics");
process.exit(1);
`);

    await expect(runWithCodex("task", {
      authFile,
      command: fixture,
      env: process.env,
      timeoutMs: 5000,
      workspace,
    })).rejects.toThrow("Codex CLI usage limit reached");
  });
});

describe("worker backend selection", () => {
  it("uses the Codex container without requiring an OpenAI API key", async () => {
    const calls = [];
    const runner = createTaskRunner({
      RELAY_WORKER_BACKEND: "codex",
      RELAY_CONTAINER_RUNTIME: "/usr/local/bin/docker",
      RELAY_CODEX_IMAGE: "relay-codex-worker:test",
      RELAY_CODEX_AUTH_FILE: "/home/relay/.codex/auth.json",
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
      options: {
        authFile: "/home/relay/.codex/auth.json",
        command: "/usr/local/bin/docker",
        image: "relay-codex-worker:test",
        model: "gpt-example",
        workspace: "/srv/repos",
      },
    });
  });

  it("keeps API-key validation for the OpenAI backend", () => {
    expect(() => createTaskRunner({ RELAY_WORKER_BACKEND: "openai" })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });
});

async function makeDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function makeExecutable(contents) {
  const directory = await makeDirectory("relay-codex-test-");
  const path = join(directory, "fake-runtime");
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
}
