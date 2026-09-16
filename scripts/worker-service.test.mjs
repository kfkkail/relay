import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  home: "/home/pi",
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:os", () => ({
  homedir: () => mocks.home,
  userInfo: () => ({ username: "pi" }),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  access: mocks.access,
  stat: mocks.stat,
  chmod: vi.fn(),
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));

const argv = process.argv;
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const nodeVersion = Object.getOwnPropertyDescriptor(process.versions, "node");
const env =
  "RELAY_URL=https://relay.example\nRELAY_WORKER_TOKEN=token\nOPENAI_API_KEY=key\n";

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.home = "/home/pi";
  Object.defineProperty(process.stdin, "isTTY", {
    value: false,
    configurable: true,
  });
  process.argv = ["node", "worker-service.mjs", "install"];
  Object.defineProperty(process, "platform", { value: "linux" });
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  vi.spyOn(process, "getuid").mockReturnValue(1000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.readFile.mockResolvedValue(env);
  mocks.exec.mockImplementation((cmd) => (cmd === "loginctl" ? "yes" : "ok"));
});
afterEach(() => {
  process.argv = argv;
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
  else delete process.stdin.isTTY;
  Object.defineProperty(process, "platform", platform);
  Object.defineProperty(process.versions, "node", nodeVersion);
  vi.restoreAllMocks();
});
const install = () => import("./worker-service.mjs");
const noInstall = () =>
  expect(
    mocks.exec.mock.calls.some(
      ([cmd, args]) =>
        (cmd === "git" && args.includes("fetch")) ||
        (cmd === "npm" && args.includes("ci")),
    ),
  ).toBe(false);

describe("worker service installation", () => {
  it("rejects Node 20 before touching configuration or running commands", async () => {
    Object.defineProperty(process.versions, "node", { value: "20.19.2" });
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Node.js 22"),
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("explains how to create missing configuration", async () => {
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error(), { code: "ENOENT" }),
    );
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("npm run setup"),
    );
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it.each(['""', '"   "', "# empty"])(
    "rejects an empty token: %s",
    async (token) => {
      mocks.readFile.mockResolvedValue(env.replace("=token", `=${token}`));
      await expect(install()).rejects.toThrow("exit");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("RELAY_WORKER_TOKEN is missing"),
      );
      noInstall();
    },
  );
  it("rejects a missing Codex executable before installing", async () => {
    mocks.readFile.mockResolvedValue(
      env +
        "RELAY_WORKER_BACKEND=codex\nRELAY_CODEX_PATH=/missing/codex\nRELAY_CODEX_WORKSPACE=/workspace\nRELAY_COMMAND_PATH=/bin",
    );
    mocks.stat.mockRejectedValue(new Error("missing"));
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("RELAY_CODEX_PATH is unavailable"),
    );
    noInstall();
  });
  it.each(["missing", "incomplete"])(
    "runs guided setup for %s configuration and resumes installation",
    async (kind) => {
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });
      if (kind === "missing")
        mocks.readFile.mockRejectedValueOnce(
          Object.assign(new Error(), { code: "ENOENT" }),
        );
      else
        mocks.readFile.mockResolvedValueOnce("RELAY_URL=https://relay.example");
      await install();
      const setup = mocks.exec.mock.calls.find(
        ([cmd]) => cmd === process.execPath,
      );
      expect(setup[1]).toEqual([
        expect.stringMatching(/scripts\/setup\.mjs$/),
        "--mode",
        "worker",
        "--skip-install",
      ]);
      expect(setup[2]).toMatchObject({ stdio: "inherit", timeout: 0 });
      expect(mocks.readFile).toHaveBeenCalledTimes(2);
      expect(
        mocks.exec.mock.calls.some(
          ([cmd, args]) => cmd === "systemctl" && args.includes("enable"),
        ),
      ).toBe(true);
    },
  );
  it("keeps valid configuration without prompting", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    await install();
    expect(
      mocks.exec.mock.calls.some(([cmd]) => cmd === process.execPath),
    ).toBe(false);
  });
  it("stops if setup is cancelled", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    mocks.readFile.mockResolvedValue("");
    mocks.exec.mockImplementation(() => {
      throw new Error("Setup cancelled");
    });
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Setup cancelled"),
    );
    noInstall();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it("revalidates setup before installing and never loops", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    mocks.readFile.mockResolvedValue("");
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Worker setup is incomplete"),
    );
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    noInstall();
  });
  it("checks the user bus before fetching or installing", async () => {
    mocks.exec.mockImplementation((cmd) => {
      if (cmd === "systemctl") throw new Error("No user bus");
      return "ok";
    });
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No user bus"),
    );
    noInstall();
  });
  it("does not wait for sudo input in a noninteractive session", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    mocks.exec.mockImplementation((cmd) => (cmd === "loginctl" ? "no" : "ok"));
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("sudo loginctl enable-linger pi"),
    );
    noInstall();
  });
  it("writes an unquoted systemd working directory and streams bounded installs", async () => {
    mocks.home = "/home/pi worker%test";
    await install();
    const unit = mocks.writeFile.mock.calls.find(([path]) =>
      path.endsWith(".service"),
    )[1];
    expect(unit).toContain(
      "WorkingDirectory=/home/pi worker%%test/.local/share/relay-worker/app\n",
    );
    expect(unit).toContain(
      '"--env-file=/home/pi worker%%test/.local/share/relay-worker/app/.env.worker"',
    );
    const npm = mocks.exec.mock.calls.find(
      ([cmd, args]) => cmd === "npm" && args[0] === "ci",
    );
    expect(npm[2]).toMatchObject({
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 600000,
    });
    expect(mocks.exec).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "enable", "--now", "relay-worker.service"],
      expect.any(Object),
    );
  });
  it("shows full status without a pager even on an older Node runtime", async () => {
    process.argv[2] = "status";
    Object.defineProperty(process.versions, "node", { value: "20.19.2" });
    await install();
    expect(mocks.exec).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "--no-pager", "--full", "status", "relay-worker.service"],
      expect.any(Object),
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it("reports a dependency timeout without writing or starting a service", async () => {
    mocks.exec.mockImplementation((cmd, args) => {
      if (cmd === "npm" && args[0] === "ci") {
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      }
      return cmd === "loginctl" ? "yes" : "ok";
    });
    await expect(install()).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("npm timed out after 600 seconds"),
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(
      mocks.exec.mock.calls.some(
        ([cmd, args]) => cmd === "systemctl" && args.includes("enable"),
      ),
    ).toBe(false);
  });
  it("preserves launchd installation", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    await install();
    expect(
      mocks.writeFile.mock.calls.some(([path]) => path.endsWith(".plist")),
    ).toBe(true);
    expect(mocks.exec.mock.calls.some(([cmd]) => cmd === "systemctl")).toBe(
      false,
    );
  });
});
