# Milestone Management in Settings

**Date:** 2026-05-08
**Status:** Approved

## Summary

Add milestone CRUD (create, rename, open/close, delete) and sprint review triggering to the project settings page. Milestones are GitHub-managed; all operations proxy through the existing state-source abstraction.

## Location

`MilestonesPanel` component appended below the existing read-only config rows in `ProjectConfigPanel`. No new routes or tabs — same settings panel, same project context.

## Architecture

Follows the established pattern:

```
StateSource interface / GitHub impl
  → milestones/service.ts
  → milestones/router.ts
  → apps/web/src/lib/api.ts
  → MilestonesPanel component
```

## Data Layer

### StateSource interface additions (`core/state-source/interface.ts`)

```ts
createMilestone(title: string): Promise<Milestone>
updateMilestone(number: number, patch: { title?: string; state?: 'open' | 'closed' }): Promise<Milestone>
deleteMilestone(number: number): Promise<void>
```

### GitHub impl (`core/state-source/github-labels.ts`)

Maps to GitHub Milestones API:
- `POST /repos/{owner}/{repo}/milestones`
- `PATCH /repos/{owner}/{repo}/milestones/{milestone_number}`
- `DELETE /repos/{owner}/{repo}/milestones/{milestone_number}`

### Milestone type enrichment

`mapGithubMilestone` currently drops `open_issues` and `closed_issues`. Add both to the `Milestone` type so the server can enforce the delete guard without a separate issues fetch.

```ts
// core/state-source/interface.ts
interface Milestone {
  number: number
  title: string
  state: 'open' | 'closed'
  openIssues: number    // new
  closedIssues: number  // new
}
```

## Server Endpoints

Four new routes in `apps/server/src/domains/milestones/router.ts`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/:slug/milestones` | Create milestone `{ title }` → `Milestone` |
| `PATCH` | `/:slug/milestones/:number` | Update `{ title?, state? }` → `Milestone` |
| `DELETE` | `/:slug/milestones/:number` | Delete (409 if has issues) |
| `GET` | `/:slug/milestones/:number/sprint-review-eligibility` | `{ eligible, reason, alreadyExists }` |

> **Note:** The existing sprint review trigger uses `/:slug/milestones/:title/sprint-review` (title-keyed). The new eligibility endpoint uses `:number` (number-keyed) for rename-safety. These are intentionally inconsistent; migrating the trigger to number-keyed is deferred.

### Validation

Server rejects creates and renames where title does not match `^M\d+:` with 422.

### Delete guard

Service layer checks two conditions before calling GitHub, returning 409 for either:
1. `openIssues + closedIssues > 0` — milestone has issues
2. Milestone number matches `project_state.activeMilestoneNumber` — would orphan the active milestone pointer

If condition 2 triggers, the user must first switch the active milestone away before deleting.

### Close / open behavior for active milestone

Closing the currently-active milestone is allowed. The milestone selector can display closed milestones; the active pointer remains valid. No special handling needed.

### Sprint review eligibility

Logic extracted from `apps/server/src/domains/workflows/sprint-review-trigger.ts` into a shared helper `checkSprintReviewEligibility(source, milestoneNumber)`. Returns:

```ts
{
  eligible: boolean       // all schedule:current issues terminal
  reason: string          // human-readable why not eligible
  alreadyExists: boolean  // sprint-review issue already filed
}
```

Both the auto-trigger (`maybeFireSprintReview`) and the new eligibility endpoint use this shared helper.

## Web Component

### `MilestonesPanel` (`apps/web/src/components/settings/components/MilestonesPanel.tsx`)

Mounted at the bottom of `ProjectConfigPanel` below a divider. Fetches milestones on mount; checks eligibility for each open milestone in parallel.

### Row layout

```
M13: Discover Lane   [open]   [▶ Sprint Review]  [✏]  [↓ Close]  [🗑]
M12: Core Features   [closed]                    [✏]  [↑ Open]   [🗑]
```

Active milestone row (matching `useActiveMilestone().activeMilestoneNumber`) rendered with accent left-stripe for visual distinction.

### Per-row actions

**Rename (✏)**
- Pencil icon → inline text input replaces title in-row
- Pre-filled with current title, cursor after last char
- Save on Enter / blur; Cancel on Escape
- Client validates `^M\d+:` before submit; server validates same
- Optimistic update, revert on error

**Open/Close toggle**
- `↓ Close` for open milestones, `↑ Open` for closed
- Fires immediately, no confirm
- Optimistic update

**Delete (🗑)**
- Trash icon → inline confirm replaces row actions: `"Delete M13? Cannot be undone. [Cancel] [Delete]"`
- Disabled + tooltip `"Milestone has issues"` when `openIssues + closedIssues > 0`
- No optimistic update — wait for server confirmation before removing from list

**Sprint Review (▶)**
- Shown only for open milestones
- States:
  - **Disabled** (`cursor-not-allowed`, tooltip showing `reason`) — not all `schedule:current` terminal
  - **Enabled** — all terminal, no review exists → fires `POST /:slug/milestones/:title/sprint-review`, shows inline success
  - **Done** (grayed, `✓ Review done`) — `alreadyExists: true`
- Eligibility fetched once on panel mount; not re-fetched until user triggers a mutation

### Add milestone

Button `+ Add` top-right of section header. Expands inline form at top of list:

```
[ M14: _________________ ]  [Create]  [Cancel]
```

Title pre-filled with `M{maxN+1}: ` (computed from loaded milestones). `maxN` is the highest M-number currently in the list. User completes the sprint name after the colon.

Client validates `^M\d+:\s+\S` before enabling Create. Server validates same pattern with 422.

### API calls added to `apps/web/src/lib/api.ts`

```ts
createMilestone(slug, title): Promise<Milestone>
updateMilestone(slug, number, patch): Promise<Milestone>
deleteMilestone(slug, number): Promise<void>
fetchSprintReviewEligibility(slug, number): Promise<SprintReviewEligibility>
```

### React Query cache invalidation

Every mutation in `MilestonesPanel` must invalidate these query keys to keep the sidebar milestone selector in sync:

| Mutation | Invalidates |
|----------|-------------|
| create | `['milestones', slug]` |
| rename | `['milestones', slug]` |
| open/close | `['milestones', slug]` |
| delete | `['milestones', slug]`, `['active-milestone', slug]` |

### configMilestoneCache stale on rename

`apps/server/src/shared/resolve-milestone.ts` caches `configTitle → milestoneNumber` for the process lifetime. Renaming a milestone on GitHub leaves a stale entry if the project config still references the old title. This is pre-existing behavior (config is file-managed). Add a note to the server rename handler pointing at this cache.

## Error handling

All mutations display inline error text below the affected row. No toast/modal — consistent with the rest of the settings page's minimal feedback style.

## Out of scope

- Editing milestone `description` — not surfaced
- Drag-to-reorder milestones — ordering is by M-number, enforced by naming convention
- Modifying `project.config.ts` `activeMilestone` string on rename — config is file-managed; `project_state` (higher priority) holds the runtime active milestone number, unaffected by title changes
