import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWakeSignal, listenForWakeups } from "./wakeup.mjs";
import { fillAvailableSlots } from "./run-scheduler.mjs";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

it("keeps a wake-up received between a claim and a wait", async () => {
  vi.useFakeTimers();
  try {
    const wake = createWakeSignal();
    wake.clear();
    wake.notify();
    wake.notify();
    await wake.wait(60000);
    expect(vi.getTimerCount()).toBe(0);

    wake.clear();
    const wait = wake.wait(60000);
    wake.notify();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("falls back to polling if no wake-up arrives", async () => {
  vi.useFakeTimers();
  try {
    const wake = createWakeSignal();
    const wait = wake.wait(60000);
    await vi.advanceTimersByTimeAsync(60000);
    await wait;
    expect(wake.pending).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("signals the scheduler after releasing the worker slot", async () => {
  const wake = createWakeSignal();
  const activeRuns = new Set();
  const run = Promise.withResolvers();
  await fillAvailableSlots({
    activeRuns,
    claim: async () => ({ id: 1 }),
    run: () => run.promise,
    onSettled: wake.notify,
    maxConcurrency: 1,
  });

  expect(activeRuns.size).toBe(1);
  const waiting = wake.wait(60000);
  run.resolve();
  await waiting;
  expect(activeRuns.size).toBe(0);
});

it("wakes on private broadcasts and on each successful subscription", async () => {
  const controller = new AbortController();
  const subscribed = Promise.withResolvers();
  const notify = vi.fn();
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((callback) => subscribed.resolve(callback)),
  };
  const client = {
    realtime: { setAuth: vi.fn() },
    getChannels: vi.fn(() => []),
    channel: vi.fn(() => channel),
    removeAllChannels: vi.fn(),
  };
  vi.mocked(createClient).mockReturnValue(client);
  const request = vi.fn(async () => ({
    url: "https://test.supabase.co",
    publishableKey: "publishable",
    topic: "relay-worker-wakeup:owner",
    token: "scoped-token",
    expiresAt: Date.now() / 1000 + 300,
  }));

  const listener = listenForWakeups({
    request,
    notify,
    signal: controller.signal,
  });
  const onStatus = await subscribed.promise;
  expect(request).toHaveBeenCalledWith("/api/worker/wakeup", {
    method: "POST",
    signal: controller.signal,
  });
  expect(client.realtime.setAuth).toHaveBeenCalledWith("scoped-token");
  expect(client.channel).toHaveBeenCalledWith("relay-worker-wakeup:owner", {
    config: { private: true },
  });
  expect(channel.on).toHaveBeenCalledWith(
    "broadcast",
    { event: "queued" },
    notify,
  );
  onStatus("SUBSCRIBED");
  onStatus("CHANNEL_ERROR");
  onStatus("SUBSCRIBED");
  channel.on.mock.calls[0][2]();
  expect(notify).toHaveBeenCalledTimes(3);
  controller.abort();
  await expect(listener).rejects.toMatchObject({ name: "AbortError" });
  expect(client.removeAllChannels).toHaveBeenCalledOnce();
});
