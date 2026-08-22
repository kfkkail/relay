import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutoUpdater, updateManagedClone } from "./auto-update.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("worker auto updates", () => {
  it("does nothing when the managed clone is current", async () => {
    const root = await fixture();
    const result = await updateManagedClone(
      root,
      fakeGit({ local: "abc", remote: "abc" }),
    );
    expect(result).toEqual({ status: "current", revision: "abc" });
  });

  it("refuses to modify a dirty clone", async () => {
    const root = await fixture();
    const result = await updateManagedClone(root, fakeGit({ dirty: " M worker/index.mjs" }));
    expect(result).toEqual({ status: "dirty" });
  });

  it("fast-forwards, validates, and reports an update", async () => {
    const root = await fixture();
    const calls = [];
    const result = await updateManagedClone(
      root,
      fakeGit({ local: "old", remote: "new", calls }),
    );
    expect(result).toEqual({ status: "updated", revision: "new" });
    expect(
      calls.some(
        ([command, args]) => command === "git" && args[0] === "merge",
      ),
    ).toBe(true);
    expect(
      calls.some(
        ([command, args]) =>
          command === process.execPath && args[0] === "--check",
      ),
    ).toBe(true);
  });

  it("retries validation from the pending marker after a failed update", async () => {
    const root = await fixture();
    await mkdir(join(root, ".relay"));
    await writeFile(
      join(root, ".relay/update-pending"),
      JSON.stringify({ dependenciesChanged: false }),
    );
    const calls = [];
    const result = await updateManagedClone(
      root,
      fakeGit({ local: "new", remote: "new", calls }),
    );
    expect(result.status).toBe("updated");
    expect(calls.some(([, args]) => args[0] === "fetch")).toBe(false);
  });

  it("checks only when enabled and due", async () => {
    let time = 100;
    const root = await fixture();
    const check = createAutoUpdater({
      root,
      enabled: true,
      intervalMs: 50,
      now: () => time,
      run: fakeGit({ local: "a", remote: "a" }),
    });
    expect((await check()).status).toBe("current");
    expect((await check()).status).toBe("not-due");
    time = 150;
    expect((await check()).status).toBe("current");
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "relay-update-test-"));
  directories.push(root);
  await writeFile(join(root, "package-lock.json"), "lock");
  return root;
}

function fakeGit({ dirty = "", local = "old", remote = "new", calls = [] } = {}) {
  let head = local;
  return async (command, args) => {
    calls.push([command, args]);
    if (command === "git" && args[0] === "status") return { stdout: dirty };
    if (command === "git" && args[0] === "rev-parse")
      return { stdout: `${args[1] === "HEAD" ? head : remote}\n` };
    if (command === "git" && args[0] === "merge") head = remote;
    return { stdout: "" };
  };
}
