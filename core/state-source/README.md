# core/state-source

Adapter layer between Goose Hub and the source of truth for work items. Two backends are supported: GitHub Issues (default) and Jira (M14).

## Modules

### `interface.ts`

Defines the abstraction every backend implements.

- **`WorkItem`** — normalised issue: id, repo, title, body, type, priority, mode, state, schedule, exec, dependencies, milestone.
- **`Milestone`** — `{ id, title, number, description?, dueOn?, isActive }`.
- **`Artifact`**, **`CreateIssueInput`**, **`SourceEvent`**, **`Subscription`** — supporting types for write paths and live updates.
- **`StateSource`** — the interface itself: `listOpenWork`, `getItem`, `listMilestones`, `getActiveMilestone`, `transitionState`, `comment`, `attach`, `createIssue`, `watchForUpdates`.

### `dependency-parser.ts`

`parseDependencies(body: string): DependencyRef[]` — extracts dependency declarations from an issue body into typed `DependencyRef` objects.

- **`DependencyRef`**: `{ type: 'depends-on' | 'blocks', repoRef: string | null, issueNumber: number }`
- Recognised prefixes (case-insensitive, whitespace-tolerant): `Depends on`, `Depends-on`, `deps:`, `blocked by`, `blocked-by`, `Blocks`, `Blocks:`
- Cross-repo refs (`owner/repo#N`) populate `repoRef`; same-repo refs (`#N`) set `repoRef: null`
- `type: 'blocks'` means the current issue blocks the referenced issue (referenced issue depends on current)
- Malformed or unrecognised lines are silently skipped — never throws
- Consumed by M11.02 resolver and M11.03 scheduler filter

### `dependency-resolver.ts`

`resolveDependency(ref, ctx)` and `DependencyResolver` — turn a `DependencyRef` into a `ResolvedDep` carrying the lifecycle state of the referenced issue.

- **`ResolvedDep`**: `{ ref, repoRef, issueNumber, state: 'open' | 'closed' | 'unregistered', title? }`
- Same-repo deps (`ref.repoRef == null`) resolve against `ctx.currentRepo`.
- Cross-repo deps resolve against the matching registered project. Unregistered repos surface `state: 'unregistered'` (M11.07 escalates these to `factory:needs-human`).
- `closed` = dep satisfied; `open` = dep unsatisfied; `unregistered` = unresolvable.
- `DependencyResolver` caches by `(repoRef, issueNumber)` for the lifetime of the instance — the orchestrator constructs one resolver per tick to avoid N+1 GitHub calls. M11.03 will re-evaluate every tick because deps close mid-sprint.
- `createProjectAwareTargetSource()` wires `loadProjects()` + per-project GitHub fetchers into a `FetchTargetFn` for production use. Tests inject a Map-backed adapter directly.

**`null` from `FetchTargetFn` is reserved for "repo not registered."** Per-project fetchers (`ProjectIssueFetcher`) must throw `DependencyTargetFetchError` on 404 / non-OK / network errors so a fetch failure on a registered repo is not silently misclassified as `unregistered` (which would falsely trigger M11.07's needs-human escalation). The resolver propagates these errors so the orchestrator can decide whether to retry or escalate.

Lifecycle (open/closed) is read straight from the GitHub issues endpoint inside the slice. `WorkItem` carries state-machine state, not GitHub-lifecycle, and the dep contract is "issue closed = dep satisfied" — keeping the API call narrow inside `core/state-source/` avoids widening the `WorkItem` shape across the codebase.

### `github-labels.ts`

`GitHubLabelsSource` — `StateSource` backed by the GitHub REST API via native `fetch`.

- Reads issues via `GET /repos/{repo}/issues?state=open` (paginated).
- Parses `factory:*` state labels through `core/state-machine/conflict-resolver.resolveState` so multi-label, archived-wins, and zero-label cases produce the correct `WorkItem.state` (no naive first-match).
- Parses auxiliary labels (`type:*`, `priority:*`, `mode:*`, `schedule:*`, `exec:*`).
- Parses `Depends on #N` and `Blocks #N` references from issue bodies.
- Read methods (`listOpenWork`, `getItem`, `listMilestones`, `getActiveMilestone`) are implemented in M1.
- Write methods (`transitionState`, `comment`, `attach`, `createIssue`, `watchForUpdates`) throw `NotImplementedError` in M1; wired up in M2.

### `jira.ts` (M14.01 / #322)

`JiraStateSource` — `StateSource` backed by the Atlassian Cloud REST API v3.

- Reads issues via `GET /rest/api/3/search` with a JQL query scoped to the
  configured project key + `issuetype in (Story, Bug, Task)` (configurable
  via `JiraSourceConfig.issueTypes`).
- HTTP Basic auth from `JIRA_HOST`, `JIRA_USER`, `JIRA_API_TOKEN`. The
  constructor throws if any of these are unset — no silent fallback.
- Status is mapped to `factory:*` state via `jira-state-map.ts`; per-project
  overrides live on `JiraSourceConfig.statusMap` (#327).
- Jira has no native milestone primitive; `listMilestones()` synthesises a
  single milestone covering open + closed counts so milestone-aware code
  paths in the orchestrator don't need to branch on `source.kind`.
- Bodies are ADF documents; `adfFromMarkdown` / `adfToText` handle the
  document conversion. Rich formatting is deferred.
- `transitionStatus()` looks up the Jira transition id for the target
  status and POSTs `POST /rest/api/3/issue/{key}/transitions`. Missing
  transitions log a warning and skip rather than throw.

### `jira-state-map.ts` (M14.02 / #327)

Default Jira status → `factory:*` mapping plus helpers
(`jiraStatusToState`, `factoryStateToJiraStatus`). Defaults cover the
canonical Atlassian workflow (To Do, In Progress, In Review, Done,
Blocked) and accept per-project overrides merged on top.

## Consumers

- `apps/cli` — `goose status <slug>` (read-only).
- `apps/server` — REST + SSE routes (M2).

Slices and surface code must go through `StateSource`; never call the GitHub or Jira APIs directly.
