# My Work v2 proposal

## Product review

The first release establishes the right boundary: Relay tasks describe work for an agent, while My Work records decisions and follow-ups owned by the person. It already supports status, due dates, snoozing, ordering, and task links.

The main usability gap is lifecycle management. An action can be captured, but its content cannot be corrected, its due date cannot be changed, and it cannot be removed. Snoozing is fixed at one day, so it does not match when the owner actually expects to revisit something. Once the list grows, there is no way to find an action or a linked task. Those gaps make the tab useful as an inbox but unreliable as a durable personal queue.

## Implemented v2 scope

- Edit an action's title, notes, and due date with the same validation as creation.
- Delete an action after an explicit destructive-action confirmation; linked-task rows are removed by the existing database cascade.
- Choose an exact future return date and time when snoozing, while keeping one-click unsnooze.
- Search the current view by title, notes, or linked-task title.
- Preserve the existing Active, Snoozed, and Done views, overdue-first ordering, status workflow, manual ordering, and task linking.
- Improve empty-search feedback and accessible labels for the new controls.

This scope deliberately requires no schema migration. It completes the existing action lifecycle using APIs and fields already shipped, keeping deployment and rollback risk low.

## Follow-on candidates

After observing v2 usage, consider saved recurring actions, bulk completion/rescheduling, and notification delivery. These introduce new persistence or background-delivery requirements and should be justified by usage rather than bundled into this iteration. Drag-and-drop ordering could also replace arrow controls on desktop, but should retain an accessible keyboard alternative.

## Acceptance criteria

1. Owners can create, find, edit, schedule, snooze, complete/reopen, and delete an action.
2. Search includes linked task names and stays scoped to the selected lifecycle view.
3. Snoozed actions return to Active automatically after the selected time.
4. Existing task links, ordering, and owner isolation continue to work unchanged.

Pull request: https://github.com/kfkkail/relay/pull/20
