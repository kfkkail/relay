import { describe, expect, it } from "vitest";
import { TASK_RUN_SUMMARY_SELECT, TASK_SELECT } from "./task-select";

describe("task selects", () => {
  it.each([TASK_SELECT, TASK_RUN_SUMMARY_SELECT])(
    "disambiguates task runs through runs.task_id",
    (select) => {
      expect(select).toContain("runs:runs!runs_task_id_fkey(");
      expect(select).not.toMatch(/(?:^|[\s,])runs\(/);
    },
  );
});
