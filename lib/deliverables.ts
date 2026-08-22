import definitions from "./deliverables.json";

export const deliverableValues = [
  "implementation_pr",
  "proposal",
  "investigation",
] as const;
export type Deliverable = (typeof deliverableValues)[number];
export const defaultDeliverable: Deliverable = "implementation_pr";
export const deliverables = definitions as Record<
  Deliverable,
  { label: string; helperText: string; contract: string }
>;

export function parseDeliverable(value: unknown): Deliverable {
  if (value === undefined) return defaultDeliverable;
  if (
    typeof value === "string" &&
    deliverableValues.includes(value as Deliverable)
  )
    return value as Deliverable;
  throw new Error("Choose a valid deliverable.");
}

export function parseDeliverableUpdate(
  value: unknown,
): Deliverable | undefined {
  return value === undefined ? undefined : parseDeliverable(value);
}

export function deliverableConflict(
  deliverable: Deliverable,
  markdown: string,
): string | null {
  const requestsPr =
    /\b(create|open|raise|submit)\s+(?:a\s+)?(?:pull request|pr)\b/i.test(
      markdown,
    );
  const forbidsChanges =
    /\b(?:do not|don't)\s+(?:(?:modify|change|write|edit)\s+(?:(?:any|the|product|source)\s+)?(?:code|codebase|repository|repo)|make\s+(?:any\s+)?(?:code|product)\s+changes|implement)\s*(?:[.!?]|$)/im.test(
      markdown,
    ) ||
    /\bwithout\s+(?:(?:modifying|changing|writing|editing)\s+(?:(?:any|the|product|source)\s+)?(?:code|codebase|repository|repo)|making\s+(?:any\s+)?(?:code|product)\s+changes|implementing)\s*(?:[.!?]|$)/im.test(
      markdown,
    ) ||
    /\bproposal only\b/i.test(markdown);
  if (deliverable !== "implementation_pr" && requestsPr)
    return `The Markdown asks for a pull request, but “${deliverables[deliverable].label}” does not permit one.`;
  if (deliverable === "implementation_pr" && forbidsChanges)
    return "The Markdown appears to prohibit implementation, but “Implement and create PR” requires code changes.";
  return null;
}
