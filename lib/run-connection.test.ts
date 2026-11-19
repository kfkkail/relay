import { expect, it } from "vitest";
import { workerConnectionInterrupted } from "./run-connection";

const now = Date.parse("2026-11-19T00:00:00Z");
const timestamp = (age: number) => new Date(now - age).toISOString();

it("shows a connection interruption only after two minutes without renewal", () => {
  expect(
    workerConnectionInterrupted(
      { status: "working", agent_heartbeat_at: timestamp(119_999) },
      now,
    ),
  ).toBe(false);
  expect(
    workerConnectionInterrupted(
      { status: "working", agent_heartbeat_at: timestamp(120_000) },
      now,
    ),
  ).toBe(true);
  expect(
    workerConnectionInterrupted(
      { status: "working", started_at: timestamp(120_000) },
      now,
    ),
  ).toBe(true);
});

it("clears the warning on renewal or a terminal status", () => {
  expect(
    workerConnectionInterrupted(
      {
        status: "working",
        agent_heartbeat_at: timestamp(0),
        started_at: timestamp(300_000),
      },
      now,
    ),
  ).toBe(false);
  for (const status of ["queued", "failed", "completed", "cancelled"])
    expect(
      workerConnectionInterrupted(
        { status, agent_heartbeat_at: timestamp(300_000) },
        now,
      ),
    ).toBe(false);
});

it("does not flag absent, invalid, or future timestamps", () => {
  for (const agent_heartbeat_at of [null, "invalid", timestamp(-60_000)])
    expect(
      workerConnectionInterrupted(
        { status: "working", agent_heartbeat_at },
        now,
      ),
    ).toBe(false);
});
