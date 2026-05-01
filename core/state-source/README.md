# core/state-source

Adapter layer between Goose Hub and the source of truth for work items (currently GitHub Issues; Jira lands in M14).

## Modules

### `interface.ts`

Defines the abstraction every backend implements.

- **`WorkItem`** — normalised issue: id, repo, title, body, type, priority, mode, state, schedule, exec, dependencies, milestone.
- **`Milestone`** — `{ id, title, number, description?, dueOn?, isActive }`.
- **`Artifact`**, **`CreateIssueInput`**, **`SourceEvent`**, **`Subscription`** — supporting types for write paths and live updates.
- **`StateSource`** — the interface itself: `listOpenWork`, `getItem`, `listMilestones`, `getActiveMilestone`, `transitionState`, `comment`, `attach`, `createIssue`, `watchForUpdates`.

### `github-labels.ts`

`GitHubLabelsSource` — `StateSource` backed by the GitHub REST API via native `fetch`.

- Reads issues via `GET /repos/{repo}/issues?state=open` (paginated).
- Parses `factory:*` state labels through `core/state-machine/conflict-resolver.resolveState` so multi-label, archived-wins, and zero-label cases produce the correct `WorkItem.state` (no naive first-match).
- Parses auxiliary labels (`type:*`, `priority:*`, `mode:*`, `schedule:*`, `exec:*`).
- Parses `Depends on #N` and `Blocks #N` references from issue bodies.
- Read methods (`listOpenWork`, `getItem`, `listMilestones`, `getActiveMilestone`) are implemented in M1.
- Write methods (`transitionState`, `comment`, `attach`, `createIssue`, `watchForUpdates`) throw `NotImplementedError` in M1; wired up in M2.

## Consumers

- `apps/cli` — `goose status <slug>` (read-only).
- `apps/server` — REST + SSE routes (M2).

Slices and surface code must go through `StateSource`; never call the GitHub API directly.
