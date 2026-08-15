import { describe, expect, it } from "vitest";
import { buildFollowUpInstructions, hasActiveRun, latestCompletedRun } from "./domain";
import type { Run } from "./types";

const run = (overrides: Partial<Run>): Run => ({
  id: crypto.randomUUID(),
  task_id: "task-1",
  status: "queued",
  attempt: 1,
  worker_id: null,
  feedback: null,
  result_markdown: null,
  result_artifacts: [],
  error: null,
  queued_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
  ...overrides,
});

describe("Relay task rules", () => {
  it("allows only queued and working runs to block another run", () => {
    expect(hasActiveRun([run({ status: "queued" })])).toBe(true);
    expect(hasActiveRun([run({ status: "working" })])).toBe(true);
    expect(hasActiveRun([run({ status: "completed" })])).toBe(false);
  });

  it("selects the newest completed result", () => {
    const newest = run({ status: "completed", attempt: 3, result_markdown: "Latest" });
    expect(
      latestCompletedRun([
        newest,
        run({ status: "completed", attempt: 1, result_markdown: "Old" }),
      ]),
    ).toEqual(newest);
  });

  it("copies accepted output into an editable follow-up context", () => {
    const instructions = buildFollowUpInstructions({
      title: "Research a move",
      accepted_result: "# Recommendation\n\nChoose option B.",
    });
    expect(instructions).toContain("Context from Research a move");
    expect(instructions).toContain("Choose option B.");
    expect(instructions).toContain("Describe what should be done next.");
  });
});
