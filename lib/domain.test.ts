import { describe, expect, it } from "vitest";
import {
  buildFollowUpInstructions,
  compareOwnerActions,
  hasActiveRun,
  latestCompletedRun,
  ownerActionFilter,
  statusLabel,
} from "./domain";
import type { OwnerAction, Run } from "./types";

const run = (overrides: Partial<Run>): Run => ({
  id: crypto.randomUUID(),
  task_id: "task-1",
  status: "queued",
  attempt: 1,
  worker_id: null,
  feedback: null,
  result_markdown: null,
  result_artifacts: [],
  result_documents: [],
  error: null,
  queued_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
  ...overrides,
});

const action = (overrides: Partial<OwnerAction>): OwnerAction => ({
  id: crypto.randomUUID(),
  title: "Owner action",
  notes: "",
  status: "todo",
  due_at: null,
  snoozed_until: null,
  position: 0,
  completed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  owner_action_tasks: [],
  ...overrides,
});

describe("Owner action rules", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("separates active, snoozed, and done actions", () => {
    expect(ownerActionFilter(action({}), now)).toBe("active");
    expect(
      ownerActionFilter(
        action({ snoozed_until: "2026-08-18T12:00:00.000Z" }),
        now,
      ),
    ).toBe("snoozed");
    expect(
      ownerActionFilter(
        action({ status: "done", completed_at: now.toISOString() }),
        now,
      ),
    ).toBe("done");
  });

  it("returns snoozed actions when the snooze time arrives", () => {
    expect(
      ownerActionFilter(action({ snoozed_until: now.toISOString() }), now),
    ).toBe("active");
  });

  it("returns snoozed actions when their due date arrives first", () => {
    expect(
      ownerActionFilter(
        action({
          due_at: now.toISOString(),
          snoozed_until: "2026-08-19T12:00:00.000Z",
        }),
        now,
      ),
    ).toBe("active");
  });

  it("orders overdue before upcoming before unscheduled", () => {
    const items = [
      action({ due_at: null }),
      action({ due_at: "2026-08-20T12:00:00.000Z" }),
      action({ due_at: "2026-08-16T12:00:00.000Z" }),
    ].sort(compareOwnerActions);
    expect(items.map((item) => item.due_at)).toEqual([
      "2026-08-16T12:00:00.000Z",
      "2026-08-20T12:00:00.000Z",
      null,
    ]);
  });

  it("does not use manual positions to order actions with the same due date", () => {
    const first = action({ due_at: "2026-08-20T12:00:00.000Z", position: 2 });
    const second = action({ due_at: "2026-08-20T12:00:00.000Z", position: 1 });
    expect(compareOwnerActions(first, second)).toBe(0);
  });

  it("relabels waiting without changing its stored value", () => {
    expect(statusLabel("waiting")).toBe("Review");
  });
});

describe("Relay task rules", () => {
  it("allows only queued and working runs to block another run", () => {
    expect(hasActiveRun([run({ status: "queued" })])).toBe(true);
    expect(hasActiveRun([run({ status: "working" })])).toBe(true);
    expect(hasActiveRun([run({ status: "completed" })])).toBe(false);
  });

  it("selects the newest completed result", () => {
    const newest = run({
      status: "completed",
      attempt: 3,
      result_markdown: "Latest",
    });
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
      instructions: "Compare the tax impact of both options.",
      accepted_result: "# Recommendation\n\nChoose option B.",
    });
    expect(instructions).toContain("Original task document");
    expect(instructions).toContain("Compare the tax impact of both options.");
    expect(instructions).toContain("Context from Research a move");
    expect(instructions).toContain("Choose option B.");
    expect(instructions).toContain("Describe what should be done next.");
  });

  it("omits the original task document section when it is empty", () => {
    const instructions = buildFollowUpInstructions({
      title: "Research a move",
      instructions: "   ",
      accepted_result: "Choose option B.",
    });

    expect(instructions).not.toContain("Original task document");
    expect(instructions).toContain("Choose option B.");
  });
});
