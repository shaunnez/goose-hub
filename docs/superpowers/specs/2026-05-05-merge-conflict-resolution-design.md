# Merge Conflict Auto-Resolution

**Date:** 2026-05-05
**Status:** Approved for implementation

## Problem

`POST /approve` returns 500 when GitHub rejects the merge due to a conflict (`405 Pull Request is not mergeable`). The user sees a generic error and must manually resolve the conflict.

## Goal

On conflict: transition to a new `factory:merge-conflict` state, spawn an autonomous agent to resolve the conflict and re-merge. On success, flow continues to `factory:done` with no human involvement. On failure, post a comment with the PR link and transition to `factory:needs-human`.

---

## State Machine

### New state

Add `factory:merge-conflict` to `core/state-machine/states.ts` (between `factory:approved` and `factory:retrospecting` in the canonical order).

### New transitions

```
factory:approved        → factory:merge-conflict   (conflict detected)
factory:approved        → factory:retrospecting     (existing happy path, unchanged)

factory:merge-conflict  → factory:retrospecting     (agent resolved + merged)
factory:merge-conflict  → factory:needs-human       (agent gave up)
```

---

## Error Detection

### `core/connectors/github/merge-pr.ts`

Add a typed error class:

```ts
export class MergeConflictError extends Error {
  constructor(public prNumber: number) {
    super(`PR #${prNumber} has a merge conflict`);
  }
}
```

GitHub returns HTTP 405 with body `{"message":"Pull Request is not mergeable"}` for merge conflicts. `mergePR` checks `response.status === 405` and throws `MergeConflictError` instead of the generic error. All other non-OK statuses continue to throw the existing generic error.

---

## Approve Flow Changes

### `apps/server/src/domains/issues/transitions.ts` — `approveIssue`

Wrap the `mergePR` call:

```ts
try {
  const merged = await mergePR({ repo: repoRef, prNumber, token });
  // ... existing success path unchanged
} catch (err) {
  if (err instanceof MergeConflictError) {
    eventStore.appendEvent({ projectId: slug, workItemId, kind: 'merge.conflict', payload: { prNumber } });
    await source.transitionState(id, 'factory:approved', 'factory:merge-conflict');
    dispatchResolveConflict(slug, Number(id)).catch((e: unknown) => {
      logger.error('dispatchResolveConflict failed', { slug, id, error: String(e) });
    });
    return { ok: false, error: 'merge-conflict', status: 409 };
  }
  throw err;
}
```

The server returns **409** (not 500) so the client can distinguish conflict from other failures.

---

## Dispatch

### `apps/server/src/shared/dispatch.ts`

New function, same pattern as `dispatchFixIssue`:

```ts
export async function dispatchResolveConflict(slug: string, issueNumber: number): Promise<void>
```

Dynamic-imports `slices/resolve-conflict/workflow.js` (rule 28a). Guards against duplicate dispatch with `_issueInFlight`.

Add to `dispatchForLabel`:

```ts
if (labelName === 'factory:merge-conflict') {
  await dispatchResolveConflict(slug, issueNumber);
  return;
}
```

---

## New Slice: `slices/resolve-conflict/`

Files required per FACTORY_RULES: `workflow.ts`, `slice.test.ts`, `README.md`.

### Workflow steps

1. Replay events for the work item → find most recent `pr.opened` → extract `branch`, `baseBranch`, `prNumber`, `prUrl`.
2. `createWorktree(runId, branch)` — checks out PR branch in isolated worktree.
3. `git fetch origin && git merge origin/<baseBranch>` in worktree.
4. If exit 0 and no conflict markers → skip to step 7 (race: conflict cleared before agent ran).
5. For each file listed in `git diff --name-only --diff-filter=U`:
   - Read file content (includes conflict markers).
   - Call Claude SDK with conflict resolution prompt from `skills/resolve-conflict/`.
   - Write resolved content back to file.
6. `git add -A && git commit -m "chore: resolve merge conflicts with <baseBranch>"`.
7. `git push origin <branch>`.
8. Call `mergePR({ repo, prNumber, token })`.
9. **On success:**
   - Emit `merge.conflict-resolved` event.
   - Emit `pr.merged` + `gate.approved` events (same as happy-path approve).
   - `cleanupWorktree(runId)`.
   - Transition `factory:merge-conflict → factory:retrospecting`.
   - Post GitHub comment: `"Merge conflict resolved automatically by agent; PR #N merged (sha)."`
10. **On any failure (push rejected, mergePR throws, Claude error, etc.):**
    - Emit `merge.conflict-unresolvable` event with error string.
    - `cleanupWorktree(runId)`.
    - Transition `factory:merge-conflict → factory:needs-human`.
    - Post GitHub comment: `"Agent could not resolve merge conflict automatically. Manual merge required: <prUrl>"`

### Skill: `skills/resolve-conflict/`

Prompt instructs Claude to:
- Read the full file with conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- Understand both sides semantically (not just pick one)
- Produce a clean merged file with no conflict markers
- Return only the file content, no explanation

---

## Client Changes

### `apps/web/src/components/detail/components/ApprovalGateSection.tsx`

On `approveMutation.onError`:
- If HTTP status is 409 and error message is `"merge-conflict"`: show neutral banner "Merge conflict detected — agent is resolving…" instead of the red error.
- Existing `invalidate()` already fires on settle, so UI polls and reflects state change automatically.

### `apps/web/src/lib/lanes.config.ts` / `constants.ts`

Add `factory:merge-conflict` lane. Position: between `factory:approved` and `factory:done` in the pipeline view. Label: "Resolving conflict".

---

## New Event Kinds

| Kind | Emitted by | Payload |
|------|-----------|---------|
| `merge.conflict` | `approveIssue` | `{ prNumber }` |
| `merge.conflict-resolved` | resolve-conflict workflow | `{ prNumber, sha }` |
| `merge.conflict-unresolvable` | resolve-conflict workflow | `{ prNumber, prUrl, error }` |

---

## Out of Scope

- Multiple rounds of conflict resolution (agent tries once; if it fails → human).
- Rebase strategy (merge commit only, consistent with existing `mergePR` default).
- Notifying the user via anything other than a GitHub comment + state transition.
