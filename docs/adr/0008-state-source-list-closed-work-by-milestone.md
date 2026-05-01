# ADR 0008 — StateSource: listClosedWorkByMilestone

Status: accepted
Date: 2026-05-01
Closes part of: M2 closed-milestone board support

## Context

The Kanban board fetches work items via `listOpenWork()`, which queries `?state=open` against the GitHub Issues API. When a milestone is closed, all its issues are closed too — so `listOpenWork()` returns nothing, and the board goes blank. For a recently-closed milestone the human still wants to see what shipped; blank is not useful.

The alternative of filtering closed issues from a broad `listOpenWork` call doesn't work because GitHub's Issues API only returns open issues for `state=open`.

## Decision

Add `listClosedWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]>` to the `StateSource` interface. The implementation in `GitHubLabelsSource` queries `?state=closed&milestone=<n>&per_page=100` and maps results through the same `mapIssueToWorkItem` path as `listOpenWork`.

The server exposes this via `GET /projects/:slug/milestones/:milestone/closed-issues`. The web board detects a closed active milestone (via the `isActive` flag on the `Milestone` type) and switches its fetch source to this route.

The CLI's `statusCommand` does **not** use this method in M2 — it always calls `listOpenWork`. Closed-milestone support in the CLI is deferred.

## Consequences

- **+** The board remains useful for historical milestone review without a separate "archive" UI.
- **+** The method name is explicit about its scope: it fetches by milestone number, not by any other filter. A caller cannot accidentally omit the milestone and get all closed issues across the repo.
- **−** All future `StateSource` adapters must implement this method. For adapters that back non-GitHub sources (future Jira, Linear, etc.) the pagination and filtering semantics need to be mapped correctly.
- **−** The method fetches up to 100 issues per page. Milestones with more than 100 issues will require the same `paginateAll` logic already used by `listOpenWork` — confirmed present in `GitHubLabelsSource`, but any new adapter must not forget it.

## Alternatives considered

- **Reuse `listOpenWork` with a closed-state flag**: rejected — the interface contract would become ambiguous (`listOpenWork(includeClosed?: boolean)` is misleading).
- **Separate `listAllWork` method that fetches both open and closed**: rejected — unnecessary for M2 scope and doubles GitHub API calls for the common case.
- **Client-side caching of the last-seen open work**: rejected — state becomes stale the moment a milestone closes; not a reliable fallback.
