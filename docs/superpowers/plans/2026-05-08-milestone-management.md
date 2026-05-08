# Milestone Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add milestone CRUD (create, rename, open/close, delete) and sprint-review triggering to the project settings panel.

**Architecture:** Four layers touched in order — (1) `core/state-source` type + GitHub impl, (2) server service + router, (3) client API + types, (4) `MilestonesPanel` React component wired below the existing read-only config rows. Sprint-review eligibility is checked lazily via a dedicated GET endpoint, not baked into `listMilestones`.

**Tech Stack:** TypeScript, Hono (server), Vitest (tests), React + TanStack Query (web), GitHub REST API

---

## File Map

| Action | File |
|--------|------|
| Modify | `core/state-source/interface.ts` |
| Modify | `core/state-source/github-labels.ts` |
| Create | `apps/server/src/domains/workflows/sprint-review-eligibility.ts` |
| Modify | `apps/server/src/domains/workflows/sprint-review-trigger.ts` |
| Modify | `apps/server/src/domains/milestones/service.ts` |
| Modify | `apps/server/src/domains/milestones/service.test.ts` |
| Modify | `apps/server/src/domains/milestones/router.ts` |
| Modify | `apps/server/src/domains/milestones/router.test.ts` |
| Modify | `apps/web/src/lib/types.ts` |
| Modify | `apps/web/src/lib/api.ts` |
| Create | `apps/web/src/components/settings/components/MilestonesPanel.tsx` |
| Modify | `apps/web/src/components/settings/components/ProjectConfigPanel.tsx` |

---

## Task 1: Enrich Milestone type + GithubMilestone + mapGithubMilestone

**Files:**
- Modify: `core/state-source/interface.ts`
- Modify: `core/state-source/github-labels.ts`

- [ ] **Step 1: Add `state`, `openIssues`, `closedIssues` to the `Milestone` interface**

In `core/state-source/interface.ts`, change the `Milestone` interface from:

```ts
export interface Milestone {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: Date;
  isActive: boolean;
}
```

To:

```ts
export interface Milestone {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: Date;
  isActive: boolean;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
}
```

- [ ] **Step 2: Add `open_issues` and `closed_issues` to `GithubMilestone` interface**

In `core/state-source/github-labels.ts`, change the `GithubMilestone` interface from:

```ts
interface GithubMilestone {
  number: number;
  title: string;
  description: string | null;
  due_on: string | null;
  state: 'open' | 'closed';
}
```

To:

```ts
interface GithubMilestone {
  number: number;
  title: string;
  description: string | null;
  due_on: string | null;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
}
```

- [ ] **Step 3: Update `mapGithubMilestone` to include the new fields**

Change `mapGithubMilestone` from:

```ts
function mapGithubMilestone(m: GithubMilestone): Milestone {
  return {
    id: String(m.number),
    title: m.title,
    number: m.number,
    description: m.description ?? undefined,
    dueOn: m.due_on != null ? new Date(m.due_on) : undefined,
    isActive: m.state === 'open',
  };
}
```

To:

```ts
function mapGithubMilestone(m: GithubMilestone): Milestone {
  return {
    id: String(m.number),
    title: m.title,
    number: m.number,
    description: m.description ?? undefined,
    dueOn: m.due_on != null ? new Date(m.due_on) : undefined,
    isActive: m.state === 'open',
    state: m.state,
    openIssues: m.open_issues,
    closedIssues: m.closed_issues,
  };
}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors (only `github-labels.ts` constructs `Milestone` objects via `mapGithubMilestone`).

- [ ] **Step 5: Commit**

```bash
git add core/state-source/interface.ts core/state-source/github-labels.ts
git commit -m "feat(core): enrich Milestone type with state, openIssues, closedIssues"
```

---

## Task 2: Add CRUD methods to StateSource interface + GitHubLabelsSource impl

**Files:**
- Modify: `core/state-source/interface.ts`
- Modify: `core/state-source/github-labels.ts`

- [ ] **Step 1: Add three method signatures to the `StateSource` interface**

In `core/state-source/interface.ts`, add these three methods to the `StateSource` interface (after `createIssue`):

```ts
createMilestone(title: string): Promise<Milestone>;
updateMilestone(number: number, patch: { title?: string; state?: 'open' | 'closed' }): Promise<Milestone>;
deleteMilestone(number: number): Promise<void>;
```

- [ ] **Step 2: Implement `createMilestone` in `GitHubLabelsSource`**

Add after `getActiveMilestone` in `core/state-source/github-labels.ts`:

```ts
async createMilestone(title: string): Promise<Milestone> {
  const url = `https://api.github.com/repos/${this.repoRef}/milestones`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`GitHub create milestone failed: ${response.status}`);
  }
  return mapGithubMilestone((await response.json()) as GithubMilestone);
}
```

- [ ] **Step 3: Implement `updateMilestone` in `GitHubLabelsSource`**

```ts
async updateMilestone(
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<Milestone> {
  const url = `https://api.github.com/repos/${this.repoRef}/milestones/${number}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`GitHub update milestone failed: ${response.status}`);
  }
  return mapGithubMilestone((await response.json()) as GithubMilestone);
}
```

- [ ] **Step 4: Implement `deleteMilestone` in `GitHubLabelsSource`**

```ts
async deleteMilestone(number: number): Promise<void> {
  const url = `https://api.github.com/repos/${this.repoRef}/milestones/${number}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: this.baseHeaders,
  });
  // 404 means already gone — treat as success.
  if (!response.ok && response.status !== 404) {
    throw new Error(`GitHub delete milestone failed: ${response.status}`);
  }
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors (`GitHubLabelsSource implements StateSource` — TypeScript will enforce all three methods are present).

- [ ] **Step 6: Commit**

```bash
git add core/state-source/interface.ts core/state-source/github-labels.ts
git commit -m "feat(core): add createMilestone/updateMilestone/deleteMilestone to StateSource + GitHub impl"
```

---

## Task 3: Extract sprint-review eligibility helper + update auto-trigger

**Files:**
- Create: `apps/server/src/domains/workflows/sprint-review-eligibility.ts`
- Modify: `apps/server/src/domains/workflows/sprint-review-trigger.ts`

- [ ] **Step 1: Write the failing test for `checkSprintReviewEligibility`**

Create `apps/server/src/domains/workflows/sprint-review-eligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkSprintReviewEligibility } from './sprint-review-eligibility.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';

function makeSource(items: { schedule: string; state: string; title: string }[]): StateSource {
  return {
    listWorkByMilestone: async () => items as never,
  } as unknown as StateSource;
}

describe('checkSprintReviewEligibility', () => {
  it('returns eligible when all schedule:current items are terminal', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:archived', title: 'Task B' },
      { schedule: 'next', state: 'factory:triage', title: 'Backlog item' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result).toEqual({ eligible: true, reason: '', alreadyExists: false });
  });

  it('returns ineligible when no schedule:current items exist', async () => {
    const source = makeSource([
      { schedule: 'next', state: 'factory:triage', title: 'Backlog item' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/no schedule:current/i);
  });

  it('returns ineligible when some schedule:current items are not terminal', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:implementing', title: 'Task B' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/1 schedule:current/i);
  });

  it('sets alreadyExists when a sprint-review issue exists for the milestone', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:done', title: 'Sprint Review: M5: Sprint' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.alreadyExists).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm test -- apps/server/src/domains/workflows/sprint-review-eligibility.test.ts
```

Expected: FAIL with "Cannot find module './sprint-review-eligibility.js'"

- [ ] **Step 3: Create `sprint-review-eligibility.ts`**

Create `apps/server/src/domains/workflows/sprint-review-eligibility.ts`:

```ts
import type { StateSource } from '@goose-hub/core/state-source/interface.js';

export interface SprintReviewEligibility {
  eligible: boolean;
  reason: string;
  alreadyExists: boolean;
}

const TERMINAL_STATES = new Set(['factory:done', 'factory:archived', 'factory:rejected']);

export async function checkSprintReviewEligibility(
  stateSource: StateSource,
  milestoneNumber: number,
  milestoneTitle: string,
): Promise<SprintReviewEligibility> {
  const allItems = await stateSource.listWorkByMilestone(milestoneNumber);
  const currentItems = allItems.filter((item) => item.schedule === 'current');
  const sprintReviewTitle = `Sprint Review: ${milestoneTitle}`;
  const alreadyExists = allItems.some((item) => item.title === sprintReviewTitle);

  if (currentItems.length === 0) {
    return { eligible: false, reason: 'No schedule:current issues in milestone', alreadyExists };
  }

  const openCurrentItems = currentItems.filter((item) => !TERMINAL_STATES.has(item.state));
  if (openCurrentItems.length > 0) {
    return {
      eligible: false,
      reason: `${openCurrentItems.length} schedule:current issue(s) not yet terminal`,
      alreadyExists,
    };
  }

  return { eligible: true, reason: '', alreadyExists };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm test -- apps/server/src/domains/workflows/sprint-review-eligibility.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Update `sprint-review-trigger.ts` to use the helper**

Replace the body of `maybeFireSprintReview` to use `checkSprintReviewEligibility`. The full updated file:

```ts
import { logger } from '@goose-hub/core/logger.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { runSprintReviewWorkflow } from '@goose-hub/core/workflows/sprint-review.js';
import { checkSprintReviewEligibility } from './sprint-review-eligibility.js';

export async function maybeFireSprintReview(
  slug: string,
  milestoneNumber: number,
  milestoneTitle: string,
  stateSource: StateSource,
): Promise<void> {
  try {
    const { eligible, alreadyExists } = await checkSprintReviewEligibility(
      stateSource,
      milestoneNumber,
      milestoneTitle,
    );

    if (alreadyExists) {
      logger.info('sprint-review: already exists, skipping', { slug, milestoneTitle });
      return;
    }

    if (!eligible) {
      return;
    }

    logger.info('sprint-review: all schedule:current items terminal, triggering sprint review', {
      slug,
      milestoneTitle,
    });

    await runSprintReviewWorkflow({
      projectId: slug,
      milestoneTitle,
      milestoneNumber,
      stateSource,
    });

    logger.info('sprint-review: completed', { slug, milestoneTitle });
  } catch (err) {
    logger.error('sprint-review: auto-trigger failed', {
      slug,
      milestoneTitle,
      error: String(err),
    });
  }
}
```

- [ ] **Step 6: Run typecheck + full test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/domains/workflows/sprint-review-eligibility.ts \
        apps/server/src/domains/workflows/sprint-review-eligibility.test.ts \
        apps/server/src/domains/workflows/sprint-review-trigger.ts
git commit -m "feat(server): extract checkSprintReviewEligibility helper, use in auto-trigger"
```

---

## Task 4: Service CRUD + eligibility functions

**Files:**
- Modify: `apps/server/src/domains/milestones/service.ts`
- Modify: `apps/server/src/domains/milestones/service.test.ts`

- [ ] **Step 1: Write failing tests for the four new service functions**

Add to `apps/server/src/domains/milestones/service.test.ts`. First, extend `mockSource` to include the three new methods (add after `listClosedWorkByMilestone`):

```ts
const mockSource = {
  getActiveMilestone: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  listWorkByMilestone: vi.fn().mockResolvedValue([]),
  listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn().mockResolvedValue(undefined),
};
```

Add the mock for `readActiveMilestone` at the top of the file alongside the other mocks:

```ts
vi.mock('./repository.js', () => ({
  writeActiveMilestone: vi.fn().mockResolvedValue(undefined),
  readActiveMilestone: vi.fn().mockResolvedValue(null),
}));
```

And add the import alongside `writeActiveMilestone`:

```ts
import { readActiveMilestone, writeActiveMilestone } from './repository.js';
```

Now add these test suites at the bottom of the file:

```ts
describe('createMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await createMilestone('unknown', 'M14: Sprint');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 422 for non-M-prefixed title', async () => {
    const result = await createMilestone('my-proj', 'Freeform Title');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('returns 422 when title has no name after colon', async () => {
    const result = await createMilestone('my-proj', 'M14: ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('creates milestone and returns it', async () => {
    const created = { id: '14', number: 14, title: 'M14: Sprint', state: 'open', openIssues: 0, closedIssues: 0, isActive: true };
    mockSource.createMilestone.mockResolvedValueOnce(created);
    const result = await createMilestone('my-proj', 'M14: Sprint');
    expect(result).toEqual({ ok: true, data: { milestone: created } });
    expect(mockSource.createMilestone).toHaveBeenCalledWith('M14: Sprint');
  });
});

describe('updateMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await updateMilestone('unknown', 14, { title: 'M14: New Name' });
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 422 when renaming to non-M-prefixed title', async () => {
    const result = await updateMilestone('my-proj', 14, { title: 'Bad Title' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
  });

  it('allows state-only update without title validation', async () => {
    const updated = { id: '14', number: 14, title: 'M14: Sprint', state: 'closed', openIssues: 0, closedIssues: 5, isActive: false };
    mockSource.updateMilestone.mockResolvedValueOnce(updated);
    const result = await updateMilestone('my-proj', 14, { state: 'closed' });
    expect(result).toEqual({ ok: true, data: { milestone: updated } });
  });

  it('updates milestone and returns it', async () => {
    const updated = { id: '14', number: 14, title: 'M14: New Name', state: 'open', openIssues: 0, closedIssues: 0, isActive: true };
    mockSource.updateMilestone.mockResolvedValueOnce(updated);
    const result = await updateMilestone('my-proj', 14, { title: 'M14: New Name' });
    expect(result).toEqual({ ok: true, data: { milestone: updated } });
    expect(mockSource.updateMilestone).toHaveBeenCalledWith(14, { title: 'M14: New Name' });
  });
});

describe('deleteMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await deleteMilestone('unknown', 14);
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 404 when milestone not found in list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 13, title: 'M13', state: 'open', openIssues: 0, closedIssues: 0 }]);
    const result = await deleteMilestone('my-proj', 14);
    expect(result).toEqual({ ok: false, error: 'milestone not found', status: 404 });
  });

  it('returns 409 when milestone has issues', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 14, title: 'M14', state: 'open', openIssues: 3, closedIssues: 0 }]);
    const result = await deleteMilestone('my-proj', 14);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/has issues/i);
  });

  it('returns 409 when milestone is currently active', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 14, title: 'M14', state: 'open', openIssues: 0, closedIssues: 0 }]);
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(14);
    const result = await deleteMilestone('my-proj', 14);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/active/i);
  });

  it('deletes milestone when empty and not active', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 14, title: 'M14', state: 'open', openIssues: 0, closedIssues: 0 }]);
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(null);
    const result = await deleteMilestone('my-proj', 14);
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(mockSource.deleteMilestone).toHaveBeenCalledWith(14);
  });
});

describe('getSprintReviewEligibility', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getSprintReviewEligibility('unknown', 5);
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns 404 when milestone not found in list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([]);
    const result = await getSprintReviewEligibility('my-proj', 99);
    expect(result).toEqual({ ok: false, error: 'milestone not found', status: 404 });
  });

  it('returns eligibility for known milestone', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([
      { number: 5, title: 'M5: Sprint', state: 'open', openIssues: 0, closedIssues: 0 },
    ]);
    mockSource.listWorkByMilestone.mockResolvedValueOnce([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
    ]);
    const result = await getSprintReviewEligibility('my-proj', 5);
    expect(result).toEqual({
      ok: true,
      data: { eligible: true, reason: '', alreadyExists: false },
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- apps/server/src/domains/milestones/service.test.ts
```

Expected: FAIL — `createMilestone`, `updateMilestone`, `deleteMilestone`, `getSprintReviewEligibility` not exported from `service.ts`.

- [ ] **Step 3: Add the four service functions to `service.ts`**

Add these imports at the top of `apps/server/src/domains/milestones/service.ts`:

```ts
import { checkSprintReviewEligibility } from '../workflows/sprint-review-eligibility.js';
import { readActiveMilestone } from './repository.js';
```

Add these constants and functions at the bottom of `service.ts`:

```ts
const MILESTONE_TITLE_RE = /^M\d+:\s+\S/;

export async function createMilestone(
  slug: string,
  title: string,
): Promise<Result<{ milestone: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  if (!MILESTONE_TITLE_RE.test(title)) {
    return { ok: false, error: 'title must match M<N>: <name> format', status: 422 };
  }
  const milestone = await source.createMilestone(title);
  return { ok: true, data: { milestone } };
}

export async function updateMilestone(
  slug: string,
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<Result<{ milestone: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  if (patch.title != null && !MILESTONE_TITLE_RE.test(patch.title)) {
    return { ok: false, error: 'title must match M<N>: <name> format', status: 422 };
  }
  // Note: renaming invalidates configMilestoneCache in resolve-milestone.ts (process-lifetime cache).
  // If project.config.ts still references the old title, resolution falls back to GitHub default
  // until server restart. This is pre-existing file-managed config behavior.
  const milestone = await source.updateMilestone(number, patch);
  return { ok: true, data: { milestone } };
}

export async function deleteMilestone(
  slug: string,
  number: number,
): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const milestones = await source.listMilestones();
  const target = milestones.find((m) => m.number === number);
  if (target == null) return { ok: false, error: 'milestone not found', status: 404 };

  if (target.openIssues + target.closedIssues > 0) {
    return { ok: false, error: 'milestone has issues', status: 409 };
  }

  const activeMilestone = await readActiveMilestone(slug);
  if (activeMilestone === number) {
    return {
      ok: false,
      error: 'milestone is currently active; switch away before deleting',
      status: 409,
    };
  }

  await source.deleteMilestone(number);
  return { ok: true, data: { ok: true } };
}

export async function getSprintReviewEligibility(
  slug: string,
  milestoneNumber: number,
): Promise<Result<{ eligible: boolean; reason: string; alreadyExists: boolean }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const milestones = await source.listMilestones();
  const milestone = milestones.find((m) => m.number === milestoneNumber);
  if (milestone == null) return { ok: false, error: 'milestone not found', status: 404 };

  const eligibility = await checkSprintReviewEligibility(source, milestoneNumber, milestone.title);
  return { ok: true, data: eligibility };
}
```

- [ ] **Step 4: Run service tests**

```bash
pnpm test -- apps/server/src/domains/milestones/service.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/milestones/service.ts \
        apps/server/src/domains/milestones/service.test.ts
git commit -m "feat(server): add createMilestone/updateMilestone/deleteMilestone/getSprintReviewEligibility service functions"
```

---

## Task 5: Router endpoints

**Files:**
- Modify: `apps/server/src/domains/milestones/router.ts`
- Modify: `apps/server/src/domains/milestones/router.test.ts`

- [ ] **Step 1: Write failing tests for the four new endpoints**

Add to the top of `apps/server/src/domains/milestones/router.test.ts`, extending the `vi.hoisted` block to add four more mocks:

```ts
const {
  mockListMilestones,
  mockListMilestoneIssues,
  mockListClosedMilestoneIssues,
  mockGetActiveMilestone,
  mockSetActiveMilestone,
  mockTriggerSprintReview,
  mockCreateMilestone,
  mockUpdateMilestone,
  mockDeleteMilestone,
  mockGetSprintReviewEligibility,
} = vi.hoisted(() => ({
  mockListMilestones: vi.fn(),
  mockListMilestoneIssues: vi.fn(),
  mockListClosedMilestoneIssues: vi.fn(),
  mockGetActiveMilestone: vi.fn(),
  mockSetActiveMilestone: vi.fn(),
  mockTriggerSprintReview: vi.fn(),
  mockCreateMilestone: vi.fn(),
  mockUpdateMilestone: vi.fn(),
  mockDeleteMilestone: vi.fn(),
  mockGetSprintReviewEligibility: vi.fn(),
}));
```

Update the `vi.mock('./service.js', ...)` block to include the four new mocks:

```ts
vi.mock('./service.js', () => ({
  listMilestones: mockListMilestones,
  listMilestoneIssues: mockListMilestoneIssues,
  listClosedMilestoneIssues: mockListClosedMilestoneIssues,
  getActiveMilestone: mockGetActiveMilestone,
  setActiveMilestone: mockSetActiveMilestone,
  triggerSprintReview: mockTriggerSprintReview,
  createMilestone: mockCreateMilestone,
  updateMilestone: mockUpdateMilestone,
  deleteMilestone: mockDeleteMilestone,
  getSprintReviewEligibility: mockGetSprintReviewEligibility,
}));
```

Add these test suites at the bottom of the file:

```ts
describe('POST /projects/:slug/milestones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 with created milestone', async () => {
    const milestone = { id: '14', number: 14, title: 'M14: Sprint', state: 'open' };
    mockCreateMilestone.mockResolvedValue({ ok: true, data: { milestone } });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'M14: Sprint' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { milestone: unknown };
    expect(body.milestone).toEqual(milestone);
  });

  it('returns 422 on validation failure', async () => {
    mockCreateMilestone.mockResolvedValue({ ok: false, error: 'title must match', status: 422 });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /projects/:slug/milestones/:number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with updated milestone', async () => {
    const milestone = { id: '14', number: 14, title: 'M14: Renamed', state: 'open' };
    mockUpdateMilestone.mockResolvedValue({ ok: true, data: { milestone } });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/14', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'M14: Renamed' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for non-numeric milestone number', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/abc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'M14: x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /projects/:slug/milestones/:number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 on success', async () => {
    mockDeleteMilestone.mockResolvedValue({ ok: true, data: { ok: true } });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/14', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('returns 409 when milestone has issues', async () => {
    mockDeleteMilestone.mockResolvedValue({ ok: false, error: 'milestone has issues', status: 409 });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/14', { method: 'DELETE' });
    expect(res.status).toBe(409);
  });
});

describe('GET /projects/:slug/milestones/:number/sprint-review-eligibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns eligibility data', async () => {
    const eligibility = { eligible: true, reason: '', alreadyExists: false };
    mockGetSprintReviewEligibility.mockResolvedValue({ ok: true, data: eligibility });
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/5/sprint-review-eligibility');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(eligibility);
  });

  it('returns 400 for non-numeric number', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-proj/milestones/abc/sprint-review-eligibility');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- apps/server/src/domains/milestones/router.test.ts
```

Expected: FAIL — new route handlers not registered.

- [ ] **Step 3: Add four routes to `router.ts`**

Update the imports in `apps/server/src/domains/milestones/router.ts`:

```ts
import {
  createMilestone,
  deleteMilestone,
  getActiveMilestone,
  getSprintReviewEligibility,
  listClosedMilestoneIssues,
  listMilestoneIssues,
  listMilestones,
  setActiveMilestone,
  triggerSprintReview,
  updateMilestone,
} from './service.js';
```

Add these four routes after the existing `router.post('/:slug/milestones/:title/sprint-review', ...)` handler, before `export { router as milestonesRouter }`:

```ts
router.post('/:slug/milestones', async (c) => {
  const body = await parseBody<{ title: string }>(c);
  if (!body.ok) return body.error;
  const result = await createMilestone(c.req.param('slug'), body.data.title);
  return result.ok
    ? c.json(result.data, 201)
    : c.json({ error: result.error }, result.status as 404 | 422);
});

router.patch('/:slug/milestones/:number', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const body = await parseBody<{ title?: string; state?: 'open' | 'closed' }>(c);
  if (!body.ok) return body.error;
  const result = await updateMilestone(c.req.param('slug'), number, body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404 | 422);
});

router.delete('/:slug/milestones/:number', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await deleteMilestone(c.req.param('slug'), number);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404 | 409);
});

router.get('/:slug/milestones/:number/sprint-review-eligibility', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await getSprintReviewEligibility(c.req.param('slug'), number);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404);
});
```

- [ ] **Step 4: Run router tests**

```bash
pnpm test -- apps/server/src/domains/milestones/router.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/milestones/router.ts \
        apps/server/src/domains/milestones/router.test.ts
git commit -m "feat(server): add CRUD + sprint-review-eligibility milestone endpoints"
```

---

## Task 6: Client types + API functions

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Update `MilestoneDto` and add `SprintReviewEligibility` in `types.ts`**

In `apps/web/src/lib/types.ts`, change `MilestoneDto` from:

```ts
export interface MilestoneDto {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: string;
  isActive: boolean;
}
```

To:

```ts
export interface MilestoneDto {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: string;
  isActive: boolean;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
}

export interface SprintReviewEligibility {
  eligible: boolean;
  reason: string;
  alreadyExists: boolean;
}
```

- [ ] **Step 2: Add `patchJson` and `deleteRequest` helpers to `api.ts`**

In `apps/web/src/lib/api.ts`, add after `postJson`:

```ts
async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

async function deleteRequest(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
}
```

- [ ] **Step 3: Add `SprintReviewEligibility` to the import list at the top of `api.ts`**

The existing import block at the top of `api.ts` imports from `./types.js`. Add `SprintReviewEligibility` to that import:

```ts
import type {
  AgentEventDto,
  BootstrapPreviewDto,
  BootstrapRunDto,
  CostSummaryDto,
  ImprovementCandidateDto,
  InboxItemDto,
  IssueCommentDto,
  IssueDiffDto,
  MilestoneDto,
  PersonaNameDto,
  PersonaRunDto,
  PersonaStatDto,
  PlaybookDetailDto,
  PlaybookSummaryDto,
  ProjectConfigDto,
  ProjectSummary,
  SprintReviewEligibility,
  TransitionResult,
  TriageResultDto,
  WorkItemCostsDto,
  WorkItemDto,
} from './types.js';
```

Also add `SprintReviewEligibility` to the `export type { ... }` block.

- [ ] **Step 4: Add five new exported API functions**

Add after `setActiveMilestone` in `api.ts`:

```ts
export async function createMilestone(slug: string, title: string): Promise<MilestoneDto> {
  const { milestone } = await postJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones`,
    { title },
  );
  return milestone;
}

export async function updateMilestone(
  slug: string,
  number: number,
  patch: { title?: string; state?: 'open' | 'closed' },
): Promise<MilestoneDto> {
  const { milestone } = await patchJson<{ milestone: MilestoneDto }>(
    `/projects/${slug}/milestones/${number}`,
    patch,
  );
  return milestone;
}

export async function deleteMilestone(slug: string, number: number): Promise<void> {
  await deleteRequest(`/projects/${slug}/milestones/${number}`);
}

export async function fetchSprintReviewEligibility(
  slug: string,
  number: number,
): Promise<SprintReviewEligibility> {
  return getJson<SprintReviewEligibility>(
    `/projects/${slug}/milestones/${number}/sprint-review-eligibility`,
  );
}

export async function triggerSprintReview(
  slug: string,
  milestoneTitle: string,
): Promise<{ issueNumber: number }> {
  return postJson<{ issueNumber: number }>(
    `/projects/${slug}/milestones/${encodeURIComponent(milestoneTitle)}/sprint-review`,
    {},
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts
git commit -m "feat(web): add MilestoneDto enrichment, SprintReviewEligibility type, CRUD API functions"
```

---

## Task 7: MilestonesPanel component

**Files:**
- Create: `apps/web/src/components/settings/components/MilestonesPanel.tsx`

- [ ] **Step 1: Create `MilestonesPanel.tsx`**

Create `apps/web/src/components/settings/components/MilestonesPanel.tsx`:

```tsx
import {
  createMilestone,
  deleteMilestone,
  fetchActiveMilestone,
  fetchMilestones,
  fetchSprintReviewEligibility,
  triggerSprintReview,
  updateMilestone,
} from '@/lib/api';
import type { MilestoneDto, SprintReviewEligibility } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  slug: string;
}

const MILESTONE_RE = /^M\d+:\s+\S/;

function maxMilestoneNumber(milestones: MilestoneDto[]): number {
  return milestones.reduce((max, m) => {
    const n = Number.parseInt(m.title.match(/^M(\d+)/)?.[1] ?? '0', 10);
    return Math.max(max, n);
  }, 0);
}

// Per-row sprint review button — isolates the eligibility query so we don't block the full list.
function SprintReviewButton({
  slug,
  milestone,
  onFired,
}: {
  slug: string;
  milestone: MilestoneDto;
  onFired: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: elig, isLoading } = useQuery<SprintReviewEligibility>({
    queryKey: ['sprint-review-eligibility', slug, milestone.number],
    queryFn: () => fetchSprintReviewEligibility(slug, milestone.number),
    staleTime: 30_000,
  });

  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState(false);

  const fire = useMutation({
    mutationFn: () => triggerSprintReview(slug, milestone.title),
    onSuccess: () => {
      setFired(true);
      void queryClient.invalidateQueries({ queryKey: ['sprint-review-eligibility', slug, milestone.number] });
      onFired();
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) return <span className="text-[11px] text-fg-3">…</span>;
  if (!elig) return null;

  if (elig.alreadyExists || fired) {
    return (
      <span className="text-[11px] text-fg-3 flex items-center gap-1">
        <Play size={10} />
        Review done
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={!elig.eligible || fire.isPending}
        title={elig.eligible ? 'Trigger sprint review' : elig.reason}
        onClick={() => fire.mutate()}
        className={[
          'flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors',
          elig.eligible && !fire.isPending
            ? 'text-fg hover:bg-bg-hover cursor-pointer'
            : 'text-fg-3 cursor-not-allowed',
        ].join(' ')}
      >
        <Play size={10} />
        Sprint Review
      </button>
      {error != null && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}

interface RowProps {
  slug: string;
  milestone: MilestoneDto;
  isActive: boolean;
  onMutated: () => void;
}

function MilestoneRow({ slug, milestone, isActive, onMutated }: RowProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(milestone.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['milestones', slug] });
    onMutated();
  };

  const rename = useMutation({
    mutationFn: (title: string) => updateMilestone(slug, milestone.number, { title }),
    onSuccess: () => { setEditing(false); invalidate(); },
    onError: (err: Error) => setRowError(err.message),
  });

  const toggle = useMutation({
    mutationFn: () =>
      updateMilestone(slug, milestone.number, {
        state: milestone.state === 'open' ? 'closed' : 'open',
      }),
    onSuccess: invalidate,
    onError: (err: Error) => setRowError(err.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteMilestone(slug, milestone.number),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['active-milestone', slug] });
    },
    onError: (err: Error) => { setConfirmDelete(false); setRowError(err.message); },
  });

  const canDelete = milestone.openIssues + milestone.closedIssues === 0;

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (MILESTONE_RE.test(editTitle) && editTitle !== milestone.title) {
        rename.mutate(editTitle);
      } else if (!MILESTONE_RE.test(editTitle)) {
        setRowError('Title must match M<N>: <name>');
      }
    }
    if (e.key === 'Escape') { setEditing(false); setEditTitle(milestone.title); }
  }

  return (
    <div
      className={[
        'flex items-center gap-2 py-1.5 px-2 rounded-md border-l-2 text-[12px]',
        isActive ? 'border-accent bg-accent-soft' : 'border-transparent',
      ].join(' ')}
    >
      {/* Title / edit input */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={() => {
              if (MILESTONE_RE.test(editTitle) && editTitle !== milestone.title) {
                rename.mutate(editTitle);
              } else {
                setEditing(false);
                setEditTitle(milestone.title);
              }
            }}
            className="w-full bg-bg border border-line rounded px-1.5 py-0.5 text-[12px] font-mono focus:outline-none focus:border-accent"
          />
        ) : (
          <span className="font-mono truncate">{milestone.title}</span>
        )}
      </div>

      {/* State badge */}
      <span
        className={[
          'text-[10px] px-1 py-0.5 rounded uppercase tracking-wider shrink-0',
          milestone.state === 'open' ? 'bg-success/10 text-success' : 'bg-fg-3/10 text-fg-3',
        ].join(' ')}
      >
        {milestone.state}
      </span>

      {/* Sprint review (open milestones only) */}
      {milestone.state === 'open' && (
        <SprintReviewButton
          slug={slug}
          milestone={milestone}
          onFired={() => void queryClient.invalidateQueries({ queryKey: ['milestones', slug] })}
        />
      )}

      {/* Actions */}
      {confirmDelete ? (
        <span className="flex items-center gap-1.5 text-[11px] shrink-0">
          <span className="text-fg-2">Delete? Cannot be undone.</span>
          <button type="button" onClick={() => setConfirmDelete(false)} className="text-fg-2 hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => remove.mutate()}
            className="text-danger hover:text-danger/80 font-medium"
          >
            Delete
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title="Rename"
            onClick={() => { setEditing(true); setEditTitle(milestone.title); }}
            className="p-1 text-fg-3 hover:text-fg rounded transition-colors"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title={milestone.state === 'open' ? 'Close milestone' : 'Reopen milestone'}
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            className="p-1 text-fg-3 hover:text-fg rounded transition-colors"
          >
            {milestone.state === 'open' ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
          <button
            type="button"
            title={canDelete ? 'Delete milestone' : 'Milestone has issues'}
            disabled={!canDelete}
            onClick={() => setConfirmDelete(true)}
            className={[
              'p-1 rounded transition-colors',
              canDelete ? 'text-fg-3 hover:text-danger' : 'text-fg-3/30 cursor-not-allowed',
            ].join(' ')}
          >
            <Trash2 size={11} />
          </button>
        </span>
      )}

      {/* Row-level error */}
      {rowError != null && (
        <span className="text-[10px] text-danger ml-1">{rowError}</span>
      )}
    </div>
  );
}

export function MilestonesPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  // Settings route is outside ActiveMilestoneProvider, so fetch independently.
  const { data: activeMilestoneData } = useQuery({
    queryKey: ['active-milestone', slug],
    queryFn: ({ signal }) => fetchActiveMilestone(slug, signal),
  });
  const activeNumber = activeMilestoneData?.milestoneNumber ?? null;
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const { data: milestones = [], isLoading } = useQuery<MilestoneDto[]>({
    queryKey: ['milestones', slug],
    queryFn: ({ signal }) => fetchMilestones(slug, signal),
  });

  function nextTitle() {
    const n = maxMilestoneNumber(milestones) + 1;
    return `M${n}: `;
  }

  function handleOpenAdd() {
    setNewTitle(nextTitle());
    setAddError(null);
    setShowAdd(true);
  }

  const add = useMutation({
    mutationFn: (title: string) => createMilestone(slug, title),
    onSuccess: () => {
      setShowAdd(false);
      setNewTitle('');
      void queryClient.invalidateQueries({ queryKey: ['milestones', slug] });
    },
    onError: (err: Error) => setAddError(err.message),
  });

  function handleAddSubmit() {
    if (!MILESTONE_RE.test(newTitle)) {
      setAddError('Title must match M<N>: <name>');
      return;
    }
    add.mutate(newTitle);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-fg-2">Milestones</h3>
        {!showAdd && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="text-[11px] text-fg-2 hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      {isLoading && <div className="text-[12px] text-fg-3 py-2">Loading…</div>}

      {showAdd && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddSubmit();
              if (e.key === 'Escape') setShowAdd(false);
            }}
            placeholder="M14: Sprint Name"
            className="flex-1 bg-bg border border-line rounded px-1.5 py-0.5 text-[12px] font-mono focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!MILESTONE_RE.test(newTitle) || add.isPending}
            onClick={handleAddSubmit}
            className="text-[11px] px-2 py-0.5 rounded bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="text-[11px] text-fg-2 hover:text-fg"
          >
            Cancel
          </button>
          {addError != null && <span className="text-[10px] text-danger">{addError}</span>}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {milestones.map((m) => (
          <MilestoneRow
            key={m.number}
            slug={slug}
            milestone={m}
            isActive={m.number === activeNumber}
            onMutated={() => void queryClient.invalidateQueries({ queryKey: ['milestones', slug] })}
          />
        ))}
      </div>

      {!isLoading && milestones.length === 0 && (
        <p className="text-[12px] text-fg-3 py-2">No milestones found.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/components/MilestonesPanel.tsx
git commit -m "feat(web): add MilestonesPanel component with CRUD and sprint-review support"
```

---

## Task 8: Wire MilestonesPanel into ProjectConfigPanel + final check

**Files:**
- Modify: `apps/web/src/components/settings/components/ProjectConfigPanel.tsx`

- [ ] **Step 1: Import `MilestonesPanel` and mount it in `ProjectConfigPanel`**

In `apps/web/src/components/settings/components/ProjectConfigPanel.tsx`, add the import:

```ts
import { MilestonesPanel } from './MilestonesPanel';
```

Remove the "To edit…" paragraph and replace the full return with:

```tsx
export function ProjectConfigPanel({ config }: Props) {
  return (
    <div data-testid="project-config-panel" className="flex flex-col gap-0">
      <Row label="Slug" value={config.slug} />
      <Row label="Source" value={`${config.source.kind}:${config.source.repo}`} />
      <Row
        label="Active Milestone"
        value={
          config.activeMilestone != null ? (
            config.activeMilestone
          ) : (
            <span className="text-fg-2 italic">github default</span>
          )
        }
      />
      <Row label="Mode" value={config.mode} />
      <Row
        label="Color"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: config.colorStripe }}
            />
            {config.colorStripe}
          </span>
        }
      />
      <Row label="Per-workflow $" value={`$${config.budgets.perWorkflowMaxUsd}`} />
      <Row label="Daily tokens" value={config.budgets.dailyTokens.toLocaleString()} />
      <Row label="Per-advisor $" value={`$${config.budgets.perAdvisorMaxUsd}`} />

      <div className="mt-6 border-t border-line pt-6">
        <MilestonesPanel slug={config.slug} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the settings page subtitle to reflect milestones are editable**

In `apps/web/src/components/settings/components/SettingsPage.tsx`, change the subtitle from:

```tsx
<p className="text-[12px] text-fg-2 mb-6">
  Read-only. All values sourced from project config files.
</p>
```

To:

```tsx
<p className="text-[12px] text-fg-2 mb-6">
  Config fields are read-only (sourced from project config files). Milestones are editable below.
</p>
```

- [ ] **Step 3: Run full typecheck + test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Fix any Biome issues with:

```bash
pnpm lint:fix
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/settings/components/ProjectConfigPanel.tsx \
        apps/web/src/components/settings/components/SettingsPage.tsx
git commit -m "feat(web): wire MilestonesPanel into settings, update subtitle"
```

---

## Verification

After all tasks complete, start the dev server and manually verify:

```bash
pnpm dev
```

Open `http://localhost:5173/settings` and confirm:
- Milestones list appears below config rows for the selected project
- Active milestone row has accent left-stripe
- `+ Add` opens inline form pre-filled with `M{N+1}: `
- Creating a non-M-prefixed title shows validation error
- Pencil icon enables inline rename; Enter saves, Escape cancels
- Close/Open toggle changes state badge immediately
- Trash is disabled on milestones with issues (tooltip: "Milestone has issues")
- Trash on empty milestone shows inline confirm; confirming removes the row
- Sprint Review button appears only on open milestones
- Disabled sprint review shows tooltip with reason
- Triggering sprint review shows "Review done" after success
