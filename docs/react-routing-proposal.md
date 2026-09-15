# React routing proposal

## Summary

Relay should use the Next.js App Router that is already part of the application. We should not add `react-router-dom` or maintain a second routing system inside Next.js.

The URL should become the source of truth for the current application area, selected record, and list filter. This makes task and owner-action pages bookmarkable, preserves the page on refresh, and gives browser Back and Forward their expected behavior.

## Proposed URLs

| URL | Screen |
| --- | --- |
| `/` | Redirect to `/tasks` |
| `/tasks` | Task list; default `inbox` filter; no task forced open |
| `/tasks?status=waiting` | Task list filtered to Waiting |
| `/tasks/{taskId}` | The named task open in the detail panel; its actual status determines the visible list filter |
| `/my-work` | My Work; default `active` filter |
| `/my-work?status=snoozed` | My Work filtered to Snoozed |
| `/my-work/{actionId}` | The named owner action open in its detail sheet |

Supported task filter values are `inbox`, `ready`, `working`, `waiting`, and `done`. Supported My Work filter values are `active`, `snoozed`, and `done`. Missing or unknown filter values fall back to the area's default instead of producing an error.

Task and action IDs belong in path segments because they identify resources. Filters belong in the query string because they alter a collection view. This also leaves room for later shareable state such as `?q=review` without redesigning the paths.

## Navigation behavior

- Clicking Tasks or My Work uses Next.js client navigation and changes the URL to `/tasks` or `/my-work` without a full-page reload.
- Clicking a task changes the URL to `/tasks/{taskId}`. Clicking a linked task from My Work does the same.
- Clicking an owner action changes the URL to `/my-work/{actionId}`. Opening one from a task uses the same canonical URL.
- Changing a filter updates `status` in the URL. It should use `router.replace` so repeatedly switching filters does not make the Back button walk through every filter click.
- Opening and closing a task or action uses `router.push`/`router.back` semantics. If there is no same-app history entry, Close should navigate to the appropriate collection URL rather than leaving Relay.
- On narrow screens, `/tasks/{taskId}` presents the existing full-width detail view. On wider screens, it presents the existing list/detail layout. The route is the same at every breakpoint.
- After creating a task, Relay navigates to `/tasks/{newTaskId}`. If a task changes status after queueing, completion, or acceptance, the URL stays stable and the list filter updates from the task's current status.
- New-task, edit-task, worker-setup, snooze, and other unsaved forms remain local modal state in this first version. Refreshing intentionally closes them; encoding partially entered form data in a URL would be surprising and unsafe.

## Application structure

Use explicit Next.js route files and a shared authenticated dashboard shell:

```text
app/
  page.tsx                         # redirect("/tasks")
  (dashboard)/
    layout.tsx                    # auth check and shared shell/data boundary
    tasks/page.tsx                # task collection
    tasks/[taskId]/page.tsx       # selected task
    my-work/page.tsx              # owner-action collection
    my-work/[actionId]/page.tsx   # selected owner action
```

The existing `Dashboard` can be migrated incrementally rather than rewritten. Give it route-derived inputs such as `area`, `initialTaskId`, `initialActionId`, and filter values; replace the `area`, `filter`, `selectedId`, and `selectedOwnerActionId` navigation setters with small functions that call `router.push` or `router.replace`. Keep fetched records and transient modal/form state in React state.

Extract the repeated server-side Supabase queries from the current root page into a shared loader used by the dashboard route layout/pages. Dynamic detail routes must verify that the requested record exists and is visible to the signed-in user. Supabase row-level security remains the authorization boundary; an inaccessible or nonexistent ID should render Next.js `notFound()` rather than silently opening a different task.

The current dashboard initially selects `initialTasks[0]`, which is why a refresh cannot represent “list only.” Route-derived selection should replace that default. `/tasks` has no selection; `/tasks/{taskId}` selects exactly that task.

## Authentication and direct links

A signed-out visit to `/tasks/{taskId}` should show sign-in and return to that exact path after GitHub authentication. The current callback always redirects to `/`, so the OAuth flow needs a validated relative return path. A practical implementation is:

1. Include the current path and query as `next` when starting OAuth.
2. Carry it through the callback URL or a short-lived, HTTP-only cookie.
3. In `/auth/callback`, accept only values beginning with a single `/` and reject absolute/protocol-relative URLs.
4. Redirect to the validated path, otherwise `/tasks`.

This validation is necessary to avoid introducing an open-redirect vulnerability.

## Loading, errors, and compatibility

- Add route-level loading UI so direct navigation does not show a blank screen while server data loads.
- Use a route-level not-found state with a link back to `/tasks` or `/my-work` for deleted, malformed, or unauthorized records.
- Preserve existing API endpoints; this proposal changes browser page routes only.
- Update the service worker only if it currently handles navigation requests specially. It should not replace server responses for `/tasks/*` or `/my-work/*` with a cached root document.
- Existing bookmarks to `/` continue to work via redirect.

## Delivery plan

### 1. Establish route state

- Add the collection/detail routes and root redirect.
- Extract the authenticated data loader and render the existing dashboard from every route.
- Parse and validate route parameters and filter query values in one typed helper.

### 2. Connect navigation

- Replace area, filter, task, and owner-action state transitions with Next.js navigation.
- Keep the client-side data refresh and mutation behavior already used by the dashboard.
- Navigate newly created tasks to their canonical URLs.

### 3. Preserve direct links through authentication

- Add a safe return path to GitHub sign-in and the auth callback.
- Add not-found and loading states.

### 4. Verify and release

- Add unit tests for route/filter parsing and safe return-path validation.
- Add browser tests for direct entry, refresh, Back/Forward, mobile close/back behavior, deleted IDs, and signed-out deep links.
- Manually verify installed/PWA navigation as well as a normal browser tab.

## Acceptance criteria

- Visiting a task or owner-action URL directly opens that exact record.
- Refreshing any supported URL leaves the user on the same logical screen and filter.
- Back and Forward restore previously opened list/detail screens.
- Copying a URL into another signed-in browser session opens the same record when authorized.
- Signing in from a deep link returns to that deep link.
- Unknown filters fall back predictably; invalid or inaccessible record IDs show a not-found state.
- Navigation remains client-side after the initial load and does not add React Router as a dependency.

## Recommendation

Implement the routes above as one focused change, with task and owner-action detail URLs included from the start. Shipping only `/tasks` and `/my-work` would preserve the broad area on refresh but would miss the most valuable use case: bookmarking or sharing the exact item being viewed.
