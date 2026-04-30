# Reference Audit — M1 Bootstrap Code

## Overview

This audit covers the bootstrap code written during M0 and early M1, before the full module
structure described in `docs/PLAN.md` was established. The goal is to identify what is clean
enough to keep as-is (PORT), what must be extracted into proper modules (REWRITE), and what
served a one-off purpose and should not enter the product (SKIP).

Per PLAN principle 15: "Reference code is evidence, not architecture."

---

## Areas Audited

### 1. State Machine (`core/state-machine/`)

**`core/state-machine/states.ts`** — PORT

A frozen const-tuple of all 23 canonical `factory:*` state names with derived `StateName` and
`State` type aliases. Clean, dependency-free, well-tested. Already the source of truth imported
by `apps/cli/src/index.ts`. No changes needed; this file is the intended end state for M1.01.

**`core/state-machine/transitions.ts`** — PORT

A typed `TRANSITIONS` record mapping every state to its legal successor states, with
`legalTargets()` and `isLegalTransition()` exports. Pure functions, no side effects,
fully typed, well-tested. Covers all paths from PLAN sections 9.1 and 9.2 including the
`needs-review → rejected` cancellation case and the `needs-fix → in-progress` re-entry loop.
Already the intended end state for M1.02.

**`core/state-machine/conflict-resolver.ts`** — NOT YET PRESENT (M1.03)

The conflict resolution logic that belongs here is currently inline in `apps/cli/src/index.ts`
as `resolveState()`. See section 2 below.

---

### 2. CLI Monolith (`apps/cli/src/index.ts`)

The file is a single 133-line entry point combining four distinct concerns. Each is a REWRITE
target that maps to a specific M1 issue.

**`resolveState()` (lines 20–36)** — REWRITE → `core/state-machine/conflict-resolver.ts` (M1.03)

Implements three of the seven conflict rules from PLAN section 9.3:
- Zero factory:* labels → defaults to `factory:triaging` with `conflict: true`
- Single label → clean, no conflict
- `factory:archived` present → archived wins, conflict flagged
- Multiple labels → picks most-advanced by canonical index

What is missing from the inline version vs PLAN section 9.3:
- Rule 3 (unknown `factory:*` label → ignore and log) is absent; the filter on `STATE_SET` silently
  drops unknowns without reporting them
- Rule 7 (illegal transition flagging, requiring comparison with previous state) is not possible
  here because `resolveState()` has no access to prior state

The core logic (frozen STATES array as a canonical order, `indexOf` comparison for most-advanced)
is worth keeping in the rewrite. The `StateResolution` type shape can be preserved but should
add a typed `ConflictReason[]` field instead of the `boolean` flag.

**`fetchIssues()` (lines 44–68)** — REWRITE → `core/state-source/github-labels.ts` (M1.06)

Implements paginated GitHub Issues fetch with:
- While-loop + page counter pagination (correct and reusable)
- Bearer token auth via `Authorization: Bearer ${token}` header
- `X-GitHub-Api-Version: 2022-11-28` pinned version header
- `User-Agent: goose-hub-cli` header
- `per_page=100` page size

What is missing vs M1.06 scope:
- Only fetches open issues; does not implement `getItem`, `listMilestones`, `getActiveMilestone`
- No label parsing beyond passing raw names to `resolveState()`; M1.06 must parse `type:*`,
  `priority:*`, `mode:*`, `schedule:*`, `exec:*` into typed fields
- No `Depends on` / `Blocks` body parsing (PLAN section 12.4)
- No rate-limit detection (HTTP 403/429 → clear error vs stack trace)
- No structured `WorkItem` output conforming to the `StateSource` interface

The pagination pattern and header set are the two specific things worth carrying forward verbatim.

**`statusCommand()` (lines 70–119)** — REWRITE → proper CLI command in M1.09

Currently: loads config from a hardcoded in-file registry, calls `fetchIssues` directly,
calls `resolveState` directly, formats and prints. M1.09 replaces this with a command that
loads config from `target-projects/<slug>/project.config.ts`, constructs a `GitHubLabelsSource`,
fetches via the `StateSource` interface, and runs the proper conflict resolver.

The output format (issue number padded to 5 chars, title truncated and padded to 42 chars,
conflict marker, summary footer) is a reasonable first pass and can be used as a reference for
the M1.09 output spec.

**Project registry object (lines 8–10)** — REWRITE → dynamic config loader in M1.09

```ts
const registry: Record<string, ProjectConfig> = {
  'goose-hub-self': gooseHubSelf,
};
```

This hardcodes a static import of the only known project. M1.09 must dynamically load
`target-projects/<slug>/project.config.ts` by slug argument (PLAN section 8). The current
pattern does not scale beyond one project and requires a code change per new project.

---

### 3. Scripts

**`scripts/install-labels.mjs`** — PORT to TypeScript (M1.07)

The idempotent label installer. Implements the canonical `factory:*` label set plus `type:*`,
`priority:*`, `mode:*`, `schedule:*`, `exec:*` auxiliary labels. The approach is correct:
GET all existing labels, compare by name, PATCH if color/description differs, POST if absent,
never DELETE. This is exactly the pattern M1.07 should replicate in TypeScript.

Specific patterns to keep:
- `GET → compare → PATCH/POST, never DELETE` idiom
- Pagination on the label list fetch (same while-loop pattern as `fetchIssues`)
- The full label array as the canonical definition (41 labels; color and description per entry)
- Exit non-zero on any failure after processing the full set

The file is plain JS with no type safety and no test. The TypeScript port should add types for
the label object shape and a test that the array contains the correct count and all required names.

**`scripts/file-m1-issues.mjs`** — SKIP

One-off bootstrap script for filing the M1 issues into GitHub. Has already served its purpose.
Contains no reusable logic beyond what `install-labels.mjs` already demonstrates (same fetch
headers, same pagination pattern). Do not port.

---

### 4. Types (`core/types.ts`)

**`ProjectConfig` / `SourceConfig`** — REWRITE/EXPAND (M1.08)

The current shape:

```ts
export interface SourceConfig {
  kind: 'github';
  repo: string;
  stateMachine: 'labels';
}

export interface ProjectConfig {
  id: string;
  name: string;
  slug: string;
  source: SourceConfig;
}
```

This is a minimal placeholder. PLAN section 8 specifies a far richer config covering:
- Per-role model and fallback config
- Per-role tool allowlists (composed from `ToolBundles`)
- Budget limits (token, cost, wall-clock per run and per milestone)
- Isolation mode (`'native'` | `'docker'`)
- Global mode (`'supervised'` | `'autonomous'`)
- `governance.immutablePaths` list
- `stack` description block (used by Bootstrap workflow)

M1.08 expands this type. The existing `SourceConfig` shape (kind/repo/stateMachine) is a
valid subset; keep it and add the remaining fields around it.

---

### 5. Patterns Worth Keeping

These patterns appear across `apps/cli/src/index.ts` and `scripts/install-labels.mjs` and
should be standardised in the M1.06 implementation and carried forward:

- **GitHub pagination**: `while (true) { fetch page N; push batch; if batch.length < 100 break; page++ }` — correct and handles the edge case where total items are an exact multiple of 100
- **Bearer token auth**: `Authorization: Bearer ${token}` with token from `GITHUB_TOKEN` env var — consistent with GitHub's current recommendation
- **API version pinning**: `X-GitHub-Api-Version: 2022-11-28` — prevents silent breaking changes from new API versions
- **`User-Agent` header**: required by GitHub API; current value is `goose-hub-cli`; standardise to `goose-hub/1.0` in M1.06
- **Idempotent label installer**: GET → compare → PATCH/POST, never DELETE — safe to re-run at any time
- **`factory:` label prefix**: all state machine and control labels share this prefix, keeping them visually distinct and filterable in `STATE_SET`

---

### 6. Gaps in the Plan

After reading the existing code against `docs/PLAN.md`:

1. **`Milestone` type not defined in TypeScript excerpts.** PLAN section 7.1 shows `listMilestones(): Promise<Milestone[]>` and `getActiveMilestone(): Promise<Milestone | null>` in the `StateSource` interface but never defines the `Milestone` shape. The existing code does not implement milestones at all. M1.05 must define this type; the issue body for M1.05 says "supporting types" without spelling them out. Minimal required fields: `id`, `title`, `state` (`'open'` | `'closed'`), `dueOn`, `number`.

2. **Dynamic config loading is assumed but not specified.** PLAN section 8 shows a full config object example but does not describe how the CLI resolves a slug to a file path. The current code uses a hardcoded registry. M1.09 needs a `loadProjectConfig(slug: string): Promise<ProjectConfig>` helper; its contract (path convention, error if missing) is not in the plan. Recommend: `target-projects/<slug>/project.config.ts`, throw `ConfigNotFoundError` if absent.

3. **Rate-limit handling is mentioned but not spec'd.** PLAN section 7.1 acceptance criteria (M1.06 issue) says "Rate-limit handling: returns clear error when limit hit" but the plan body does not describe the retry or back-off policy. The existing code throws a generic `GitHub API error: 403` string. For M1.06, the minimum bar is a typed `RateLimitError` with `resetAt: Date`; retry policy can be deferred.

4. **`ConflictReason` type is not defined anywhere.** PLAN section 9.3 mandates "Conflict reasons are typed and machine-readable (not free strings)" but does not give the type shape. The existing code uses `conflict: boolean`. M1.03 must define this enum/union; suggest: `'no-state-label' | 'multiple-state-labels' | 'archived-wins' | 'unknown-label'`.

5. **No error taxonomy for the CLI.** The existing `statusCommand` mixes `console.error` + `process.exit(1)` for all errors (missing slug, unknown project, missing token, API error). PLAN does not define expected exit codes or error message format. This is a minor gap but worth noting before M1.09 is built.

6. **`watchForUpdates` punt boundary not in the plan.** PLAN section 7.1 lists `watchForUpdates` but M1.06 notes it can throw "not implemented" until M3. The plan does not say which milestone introduces it. Worth filing a follow-up issue to pin the milestone.

---

### 7. Code to Avoid Porting

- **The monolithic single-file CLI pattern.** `apps/cli/src/index.ts` puts config loading, API calls, state resolution, and output formatting in one 133-line file. Each concern belongs in its own module.
- **Hardcoded project registries.** The `registry` object at the top of `index.ts` must not appear in the M1.09 implementation. Config loads from disk by slug.
- **Plain JS scripts with no types.** The `.mjs` scripts were acceptable for M0 bootstrap; they should not be the pattern for any M1+ production code.
- **Inline prompts.** There are none in the current codebase, but this is a forward guard: any prompt strings that appear in `.ts` files rather than versioned `skills/<name>/` markdown files fail review (FACTORY_RULES rule applying to skill chain).
- **Bare `throw new Error(string)` for API errors.** The existing `fetchIssues` throws a plain `Error` with a message string. All API errors in M1.06+ should be typed error classes so callers can discriminate.

---

## Verdict Summary Table

| Area | File(s) | Verdict | Target |
|---|---|---|---|
| State enum | `core/state-machine/states.ts` | PORT | Already in place (M1.01 done) |
| Transition table | `core/state-machine/transitions.ts` | PORT | Already in place (M1.02 done) |
| Conflict resolver | inline `resolveState()` in `apps/cli/src/index.ts` | REWRITE | `core/state-machine/conflict-resolver.ts` (M1.03) |
| GitHub issues fetch | inline `fetchIssues()` in `apps/cli/src/index.ts` | REWRITE | `core/state-source/github-labels.ts` (M1.06) |
| Status command | inline `statusCommand()` in `apps/cli/src/index.ts` | REWRITE | `apps/cli/` package (M1.09) |
| Project registry | inline `registry` object in `apps/cli/src/index.ts` | REWRITE | Dynamic loader in M1.09 |
| Label installer | `scripts/install-labels.mjs` | PORT (to TS) | `scripts/install-labels.ts` (M1.07) |
| M1 issue filer | `scripts/file-m1-issues.mjs` | SKIP | One-off; do not port |
| Core types | `core/types.ts` | REWRITE/EXPAND | Expanded `ProjectConfig` (M1.08) |
| Pagination pattern | Both scripts + CLI | PORT pattern | Standardise in M1.06 |
| Auth + header set | Both scripts + CLI | PORT pattern | Standardise in M1.06 |
| Idempotent label install | `scripts/install-labels.mjs` | PORT pattern | Replicate in M1.07 |

---

## Sign-off

Awaiting human sign-off in PR comment.
