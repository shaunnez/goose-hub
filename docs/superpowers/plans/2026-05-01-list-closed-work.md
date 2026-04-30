# listClosedWork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a closed milestone is selected, fetch closed GitHub issues via a new `listClosedWork(milestoneNumber)` API instead of filtering from the open-issues list.

**Architecture:** Add `listClosedWork(milestoneNumber: number)` to the `StateSource` interface and implement it in `GitHubLabelsSource` using `?state=closed&milestone=<n>`. Expose it via a new server route `GET /projects/:slug/milestones/:milestone/closed-issues`. In `Board.tsx`, detect when the active milestone is closed (using `milestones` from `useActiveMilestone`) and switch the fetch source accordingly. The CLI's `statusCommand` similarly switches to `listClosedWork` when the active milestone is closed.

**Tech Stack:** TypeScript, Vitest, Hono, React, GitHub REST API v3

---

## File Map

| File | Change |
|------|--------|
| `core/state-source/interface.ts` | Add `listClosedWork(milestoneNumber: number): Promise<WorkItem[]>` to `StateSource` |
| `core/state-source/github-labels.ts` | Implement `listClosedWork` using `?state=closed&milestone=<n>` |
| `core/state-source/interface.test.ts` | Add `listClosedWork` stub to `StubStateSource` |
| `core/state-source/github-labels.test.ts` | Add `listClosedWork` unit tests |
| `apps/server/src/index.ts` | Add `GET /projects/:slug/milestones/:milestone/closed-issues` |
| `apps/web/src/lib/api.ts` | Add `fetchClosedIssues(slug, milestoneNumber)` |
| `apps/web/src/components/board/Board.tsx` | Detect closed milestone and call `fetchClosedIssues` |
| `apps/cli/src/index.ts` | Switch to `listClosedWork` when active milestone is closed |

---

### Task 1: Extend the StateSource interface

**Files:**
- Modify: `core/state-source/interface.ts:62-77`
- Modify: `core/state-source/interface.test.ts:13-57`

- [ ] **Step 1: Write the failing typecheck**

Open `core/state-source/interface.test.ts`. The `StubStateSource` class must implement `StateSource`. Adding the method to the interface will break the typecheck because the stub won't have it yet — so add the method to the interface first, then update the stub.

Add `listClosedWork` to `StateSource` in `core/state-source/interface.ts`:

```typescript
export interface StateSource {
  projectId: string;
  repoRef: string;

  listOpenWork(): Promise<WorkItem[]>;
  listClosedWork(milestoneNumber: number): Promise<WorkItem[]>;
  getItem(itemId: string): Promise<WorkItem>;
  listMilestones(): Promise<Milestone[]>;
  getActiveMilestone(): Promise<Milestone | null>;

  transitionState(itemId: string, from: StateName, to: StateName, note?: string): Promise<void>;
  comment(itemId: string, body: string): Promise<void>;
  attach(itemId: string, artifact: Artifact): Promise<void>;
  createIssue(input: CreateIssueInput): Promise<WorkItem>;

  watchForUpdates(callback: (event: SourceEvent) => void): Promise<Subscription>;
}
```

- [ ] **Step 2: Verify typecheck fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: errors in `github-labels.ts` and `interface.test.ts` about missing `listClosedWork`.

- [ ] **Step 3: Update the stub in interface.test.ts**

Add the stub method to `StubStateSource` in `core/state-source/interface.test.ts`:

```typescript
listClosedWork(_milestoneNumber: number): Promise<WorkItem[]> {
  return Promise.resolve([]);
}
```

Insert it after `listOpenWork()` (currently line 17).

- [ ] **Step 4: Verify typecheck still fails (only github-labels.ts remaining)**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: only `github-labels.ts` error about missing `listClosedWork`.

---

### Task 2: Implement listClosedWork in GitHubLabelsSource

**Files:**
- Modify: `core/state-source/github-labels.ts`

- [ ] **Step 1: Write the failing test first**

Add to `core/state-source/github-labels.test.ts`, after the `getActiveMilestone` describe block:

```typescript
// ---------------------------------------------------------------------------
// listClosedWork
// ---------------------------------------------------------------------------

describe('listClosedWork', () => {
  it('fetches closed issues for the given milestone number', async () => {
    const closedIssues = [
      makeIssue({
        number: 20,
        title: 'Done feature',
        labels: [{ name: 'factory:done' }],
        milestone: { number: 2, title: 'M2', description: null, due_on: null, state: 'closed' },
      }),
      makeIssue({
        number: 21,
        title: 'Archived chore',
        labels: [{ name: 'factory:archived' }, { name: 'type:chore' }],
        milestone: { number: 2, title: 'M2', description: null, due_on: null, state: 'closed' },
      }),
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        // Must include state=closed and milestone=2.
        expect(url).toContain('state=closed');
        expect(url).toContain('milestone=2');
        return new Response(JSON.stringify(closedIssues), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const source = makeSource();
    const items = await source.listClosedWork(2);

    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe('20');
    expect(items[0].state).toBe('factory:done');
    expect(items[1].externalId).toBe('21');
    expect(items[1].type).toBe('chore');
  });

  it('filters out pull requests from closed issues', async () => {
    const mixed = [
      makeIssue({ number: 30, labels: [{ name: 'factory:done' }] }),
      { ...makeIssue({ number: 31 }), pull_request: {} },
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl(() =>
        new Response(JSON.stringify(mixed), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const source = makeSource();
    const items = await source.listClosedWork(2);
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe('30');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/state-source/github-labels.test.ts 2>&1 | tail -20
```

Expected: FAIL — `listClosedWork is not a function`.

- [ ] **Step 3: Implement listClosedWork**

Add this method to `GitHubLabelsSource` in `core/state-source/github-labels.ts`, after `listOpenWork()` (currently line 217–223):

```typescript
async listClosedWork(milestoneNumber: number): Promise<WorkItem[]> {
  const url = `https://api.github.com/repos/${this.repoRef}/issues?state=closed&milestone=${milestoneNumber}&per_page=100`;
  const issues = await this.paginateAll<GithubIssue>(url);
  return issues
    .filter((i) => i.pull_request == null)
    .map((i) => mapIssueToWorkItem(i, this.repoRef, this.ownerLogin));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/state-source/github-labels.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Verify typecheck passes**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add core/state-source/interface.ts core/state-source/interface.test.ts core/state-source/github-labels.ts core/state-source/github-labels.test.ts
git commit -m "feat(core): add listClosedWork to StateSource and GitHubLabelsSource"
```

---

### Task 3: Add server route for closed issues

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Write the failing test**

The server has no dedicated test file yet. Add this inline test to confirm the route exists and is reachable. But since this is an integration test against the Hono app, use the Hono test client. Create `apps/server/src/index.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

// Minimal stub for getSourceForSlug
vi.mock('./source.js', () => ({
  getSourceForSlug: vi.fn().mockResolvedValue({
    repoRef: 'owner/repo',
    listClosedWork: vi.fn().mockResolvedValue([
      {
        id: 'github:owner/repo#5',
        externalId: '5',
        repoRef: 'owner/repo',
        title: 'Done item',
        body: '',
        type: 'feature',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:done',
        authorIsOwner: true,
        milestoneId: '3',
        schedule: 'current',
        exec: 'parallel',
        dependsOn: [],
        blocks: [],
        createdAt: new Date('2024-01-01'),
      },
    ]),
  }),
}));

describe('GET /projects/:slug/milestones/:milestone/closed-issues', () => {
  it('returns closed work items for the milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/3/closed-issues');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/milestones/3/closed-issues');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run apps/server/src/index.test.ts 2>&1 | tail -20
```

Expected: FAIL — 404 for the first test (route not registered).

- [ ] **Step 3: Add the route to server/src/index.ts**

Add this route after the existing `/projects/:slug/issues` route (around line 33):

```typescript
app.get('/projects/:slug/milestones/:milestone/closed-issues', async (c) => {
  const slug = c.req.param('slug');
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const items = await getCached(
    `closed-issues:${slug}:${milestone}`,
    60_000,
    () => source.listClosedWork(milestone),
  );
  return c.json({ items });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run apps/server/src/index.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Verify typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/index.test.ts
git commit -m "feat(server): add GET /projects/:slug/milestones/:milestone/closed-issues route"
```

---

### Task 4: Add fetchClosedIssues to the web API client

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add fetchClosedIssues after fetchIssues**

In `apps/web/src/lib/api.ts`, add after `fetchIssue`:

```typescript
export async function fetchClosedIssues(slug: string, milestoneNumber: number): Promise<WorkItemDto[]> {
  const { items } = await getJson<{ items: WorkItemDto[] }>(
    `/projects/${slug}/milestones/${milestoneNumber}/closed-issues`,
  );
  return items;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add fetchClosedIssues API helper"
```

---

### Task 5: Update Board.tsx to use fetchClosedIssues for closed milestones

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`

Board.tsx now uses TanStack Query (`useQuery`). When the active milestone is closed, switch the `queryKey` and `queryFn` so TanStack Query fetches closed issues instead. `useActiveMilestone()` provides `milestones` and `activeNumber`; use them to derive `isClosed`.

Current relevant section (lines 15–29):
```typescript
export function Board({ projectSlug }: BoardProps) {
  const queryClient = useQueryClient();
  const { hidden, toggle, reset } = useLaneVisibility();
  const { activeNumber: resolvedMilestone } = useActiveMilestone();

  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['issues', projectSlug],
    queryFn: () => fetchIssues(projectSlug),
  });
```

- [ ] **Step 1: Update the import in Board.tsx**

Change line 1:

```typescript
import { type WorkItemDto, fetchClosedIssues, fetchIssues } from '@/lib/api';
```

- [ ] **Step 2: Destructure milestones and derive isClosed**

Replace the `useActiveMilestone` line and the `useQuery` block (lines 18–29) with:

```typescript
const { activeNumber: resolvedMilestone, milestones } = useActiveMilestone();

const activeMilestone = useMemo(
  () => milestones.find((m) => m.number === resolvedMilestone) ?? null,
  [milestones, resolvedMilestone],
);
const isClosed = activeMilestone != null && !activeMilestone.isActive;

const {
  data: items = [],
  isLoading,
  isError,
  error,
  refetch,
} = useQuery({
  queryKey:
    isClosed && resolvedMilestone != null
      ? ['closed-issues', projectSlug, resolvedMilestone]
      : ['issues', projectSlug],
  queryFn: () =>
    isClosed && resolvedMilestone != null
      ? fetchClosedIssues(projectSlug, resolvedMilestone)
      : fetchIssues(projectSlug),
});
```

The SSE handler targets `['issues', projectSlug]` and does not need to change — live transition patches only apply to open work.

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start the server and web app. Select a closed milestone from the dropdown. Verify the board shows closed issues for that milestone. The issue count in the board header should reflect what's returned by the closed-issues endpoint.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/board/Board.tsx
git commit -m "feat(web): switch Board to fetchClosedIssues when active milestone is closed"
```

---

### Task 6: Update CLI statusCommand to use listClosedWork

**Files:**
- Modify: `apps/cli/src/index.ts`

The CLI's `statusCommand` uses `listOpenWork` unconditionally. If the active milestone is closed, switch to `listClosedWork`.

- [ ] **Step 1: Update statusCommand**

Replace the `try` block in `statusCommand` (currently lines 40–51) with:

```typescript
try {
  const [work, milestone] = await Promise.all([
    source.getActiveMilestone(),
    source.listMilestones(),
  ]);
  if (work != null) {
    milestoneLabel = work.title;
    if (!work.isActive) {
      // Active milestone is closed — fetch closed issues for it.
      items = await source.listClosedWork(work.number);
    } else {
      items = await source.listOpenWork();
    }
  } else {
    items = await source.listOpenWork();
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
```

Wait — the existing code uses `Promise.all([source.listOpenWork(), source.getActiveMilestone()])`. We need the milestone first to decide which fetch to call. Restructure as two awaits (or sequential calls):

```typescript
let items: WorkItem[];
let milestoneLabel: string | null = null;

try {
  const milestone = await source.getActiveMilestone();
  if (milestone != null) {
    milestoneLabel = milestone.title;
  }
  items =
    milestone != null && !milestone.isActive
      ? await source.listClosedWork(milestone.number)
      : await source.listOpenWork();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
```

Also remove the old `let items: WorkItem[];` and `let milestoneLabel: string | null = null;` declarations that currently appear at lines 36–37 since they're now inside the `try` block initializer — actually keep them at the top since they're used below the `try`. Keep existing declaration structure; just replace the `try` block body.

The full corrected `try` block replacing lines 40–51:

```typescript
try {
  const milestone = await source.getActiveMilestone();
  if (milestone != null) {
    milestoneLabel = milestone.title;
  }
  items =
    milestone != null && !milestone.isActive
      ? await source.listClosedWork(milestone.number)
      : await source.listOpenWork();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/index.ts
git commit -m "feat(cli): use listClosedWork when active milestone is closed"
```

---

### Task 7: Full test suite verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck across all packages**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm biome check --write . 2>&1 | tail -20
```

Expected: clean.

---

## Self-Review

**Spec coverage:**
- `listClosedWork(milestoneNumber)` added to `StateSource` interface — Task 1
- Implemented in `GitHubLabelsSource` — Task 2
- Server route `GET /projects/:slug/milestones/:milestone/closed-issues` — Task 3
- Web API helper `fetchClosedIssues` — Task 4
- `Board.tsx` switches fetch when milestone is closed — Task 5
- CLI `statusCommand` switches fetch when milestone is closed — Task 6
- Tests at every layer — Tasks 1, 2, 3

**Placeholder scan:** No TBDs, no "similar to Task N", all code shown.

**Type consistency:** `listClosedWork(milestoneNumber: number): Promise<WorkItem[]>` is consistent across interface, implementation, and server. `fetchClosedIssues(slug: string, milestoneNumber: number): Promise<WorkItemDto[]>` is consistent between api.ts and Board.tsx usage.
