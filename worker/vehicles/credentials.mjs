import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function autoDevKey({
  env = process.env,
  platform = process.platform,
  run = execute,
} = {}) {
  if (env.AUTODEV_API_KEY?.trim()) return env.AUTODEV_API_KEY.trim();
  if (platform !== "darwin")
    throw new Error(
      "Configure AUTODEV_API_KEY in the worker secret environment.",
    );
  try {
    const { stdout } = await run(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        "relay-worker",
        "-s",
        "com.relay.auto-dev.api-key",
        "-w",
      ],
      { timeout: 10000, maxBuffer: 16384 },
    );
    if (stdout.trim()) return stdout.trim();
  } catch {
    // Child-process diagnostics can contain credentials; never forward them.
  }
  throw new Error("Auto.dev credential is unavailable in the worker Keychain.");
}
