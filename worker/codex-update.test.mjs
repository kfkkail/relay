import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_UPDATE_INTERVAL_MS,
  codexInstallStrategy,
  createCodexAutoUpdater,
  runUpdateCommand,
} from "./codex-update.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const environment = {
  RELAY_WORKER_BACKEND: "codex",
  RELAY_WORKER_AUTO_UPDATE: "on",
  RELAY_CODEX_PATH: "/worker/bin/codex",
  RELAY_COMMAND_PATH: "/worker/bin:/usr/bin",
  RELAY_WORKER_TOKEN: "relay_secret",
  OPENAI_API_KEY: "sk-secret",
};

function fakeUpdate() {
  let upgraded = false;
  return vi.fn(async (_command, args) => {
    if (args[0] === "--version")
      return { stdout: `codex-cli ${upgraded ? "0.167.0" : "0.160.0"}\n` };
    upgraded = true;
    return { stdout: "" };
  });
}

describe("idle Codex auto updates", () => {
  it("updates the configured executable and verifies its version using a sanitized environment", async () => {
    const run = fakeUpdate();
    const check = createCodexAutoUpdater({
      env: environment,
      run,
      strategy: async () => ({ kind: "native" }),
    });
    expect(await check()).toEqual({
      status: "updated",
      previousVersion: "0.160.0",
      version: "0.167.0",
    });
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [environment.RELAY_CODEX_PATH, ["--version"]],
      [environment.RELAY_CODEX_PATH, ["update"]],
      [environment.RELAY_CODEX_PATH, ["--version"]],
    ]);
    for (const [, , options] of run.mock.calls) {
      expect(options.cwd).toBe("/");
      expect(options.env.PATH).toBe(environment.RELAY_COMMAND_PATH);
      expect(options.env.RELAY_WORKER_TOKEN).toBeUndefined();
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
    }
    expect(run.mock.calls[1][2].timeout).toBe(10 * 60_000);
  });

  it.each([
    { ...environment, RELAY_WORKER_BACKEND: "openai" },
    { ...environment, RELAY_CODEX_AUTO_UPDATE: "off" },
    { ...environment, RELAY_WORKER_AUTO_UPDATE: "off" },
  ])("respects backend selection and update opt-outs", async (env) => {
    const run = fakeUpdate();
    expect((await createCodexAutoUpdater({ env, run })()).status).toBe(
      "disabled",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("never starts during active runs and waits a day between checks", async () => {
    let time = 100;
    const run = fakeUpdate();
    const check = createCodexAutoUpdater({
      env: environment,
      run,
      now: () => time,
      strategy: async () => ({ kind: "native" }),
    });
    expect((await check({ activeRuns: 1 })).status).toBe("busy");
    expect(run).not.toHaveBeenCalled();
    expect((await check()).status).toBe("updated");
    expect((await check()).status).toBe("not-due");
    time += CODEX_UPDATE_INTERVAL_MS;
    expect((await check()).status).toBe("current");
  });

  it("prevents overlapping update attempts", async () => {
    let release;
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ stdout: "codex-cli 0.167.0" });
        }),
    );
    const check = createCodexAutoUpdater({
      env: environment,
      run,
      strategy: async () => ({ kind: "unsupported" }),
    });
    const pending = check();
    expect((await check()).status).toBe("busy");
    release();
    expect((await pending).status).toBe("unsupported");
  });

  it("updates older global npm installs at their owning prefix", async () => {
    const run = fakeUpdate();
    const check = createCodexAutoUpdater({
      env: environment,
      run,
      strategy: async () => ({
        kind: "npm",
        prefix: "/home/pi/.nvm/versions/node/v22.1.0",
      }),
    });
    expect((await check()).status).toBe("updated");
    expect(run.mock.calls[1].slice(0, 2)).toEqual([
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        "/home/pi/.nvm/versions/node/v22.1.0",
        "@openai/codex@latest",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
    ]);
  });

  it.each([
    [{ code: "TIMEOUT" }, "timed out"],
    [{ code: "ENOENT" }, "not found"],
    [{ stderr: "npm EACCES sensitive-token" }, "could not write"],
    [
      { stderr: "error: unrecognized subcommand 'update' sensitive-token" },
      "does not support",
    ],
    [{ stderr: "network failure sensitive-token" }, "update failed"],
  ])(
    "keeps updater failures bounded and does not leak raw installer output",
    async (failure, message) => {
      const run = vi
        .fn()
        .mockResolvedValueOnce({ stdout: "codex-cli 0.160.0" })
        .mockRejectedValue(failure);
      const check = createCodexAutoUpdater({
        env: environment,
        run,
        strategy: async () => ({ kind: "native" }),
      });
      const result = await check();
      expect(result).toMatchObject({
        status: "error",
        error: expect.stringContaining(message),
      });
      expect(JSON.stringify(result)).not.toContain("sensitive-token");
      expect((await check()).status).toBe("not-due");
    },
  );

  it("does not claim success if post-update validation fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "codex-cli 0.160.0" })
      .mockResolvedValueOnce({ stdout: "updated" })
      .mockResolvedValueOnce({ stdout: "broken" });
    const check = createCodexAutoUpdater({
      env: environment,
      run,
      strategy: async () => ({ kind: "native" }),
    });
    expect(await check()).toMatchObject({
      status: "error",
      error: expect.stringContaining("valid version"),
    });
  });
});

describe("Codex installation and update command", () => {
  it("finds the owning npm prefix through the configured executable symlink", async () => {
    const root = await fixture();
    const pkg = join(root, "lib/node_modules/@openai/codex");
    await mkdir(join(pkg, "bin"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@openai/codex" }),
    );
    await writeFile(join(pkg, "bin/codex.js"), "#!/usr/bin/env node\n");
    const command = join(root, "codex");
    await symlink(join(pkg, "bin/codex.js"), command);
    expect(await codexInstallStrategy(command, {})).toEqual({
      kind: "npm",
      prefix: root,
    });
  });

  it("does not turn a project-local installation into a global update", async () => {
    const root = await fixture();
    const pkg = join(root, "node_modules/@openai/codex");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@openai/codex" }),
    );
    const command = join(pkg, "codex");
    await writeFile(command, "binary");
    expect(await codexInstallStrategy(command, {})).toEqual({
      kind: "unsupported",
    });
  });

  it("uses the captured command PATH for standalone installations", async () => {
    const root = await fixture();
    const command = join(root, "codex");
    await writeFile(command, "binary");
    await chmod(command, 0o700);
    expect(await codexInstallStrategy("codex", { PATH: root })).toEqual({
      kind: "native",
    });
  });

  it("closes stdin for unattended commands", async () => {
    const result = await runUpdateCommand(
      process.execPath,
      [
        "-e",
        "process.stdin.on('end',()=>console.log('closed'));process.stdin.resume()",
      ],
      { timeout: 3000, cwd: "/", env: process.env },
    );
    expect(result.stdout.trim()).toBe("closed");
  });

  it("terminates an update and its subprocess group on timeout", async () => {
    await expect(
      runUpdateCommand(
        process.execPath,
        [
          "-e",
          "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)",
        ],
        { timeout: 300, cwd: "/", env: process.env },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "relay-codex-update-"));
  directories.push(path);
  return path;
}
