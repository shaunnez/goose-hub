# Merge Conflict Auto-Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When "Approve & merge" hits a GitHub merge conflict (405), transition the issue to `factory:merge-conflict`, spawn an agent to rebase/resolve/push/re-merge autonomously, then go to `factory:done` on success or `factory:needs-human` on failure.

**Architecture:** New `factory:merge-conflict` state sits between `factory:approved` and `factory:done`. `mergePR` throws a typed `MergeConflictError` on GitHub 405. `approveIssue` catches it, transitions state, returns 409. The router detects 409 and fires `dispatchResolveConflict`. The new `slices/resolve-conflict/` workflow checks out the PR branch in a worktree, merges the base branch, runs a Claude agent to fix conflict markers, pushes, and re-merges via the GitHub API.

**Tech Stack:** TypeScript, Node, Vitest, React/TSX, Zod, Hono, git worktrees, ClaudeCliRuntime

**Spec:** `docs/superpowers/specs/2026-05-05-merge-conflict-resolution-design.md`

---

## File Map

| File | Change |
|------|--------|
| `core/state-machine/states.ts` | Add `factory:merge-conflict` |
| `core/state-machine/transitions.ts` | Add transitions for new state |
| `core/state-machine/states.test.ts` | Update count (24→25) + add state in order |
| `core/state-machine/transitions.test.ts` | Add transition tests |
| `core/connectors/github/merge-pr.ts` | Add `MergeConflictError`, detect 405 |
| `core/connectors/github/slice.test.ts` | Add conflict detection tests |
| `apps/server/src/domains/issues/transitions.ts` | Catch `MergeConflictError` in `approveIssue` |
| `apps/server/src/domains/issues/service.test.ts` | Add conflict case test |
| `apps/server/src/domains/issues/router.ts` | Add 409 status + dispatch call |
| `apps/server/src/domains/issues/router.test.ts` | Add 409 router test |
| `apps/server/src/shared/dispatch.ts` | Add `dispatchResolveConflict` + `dispatchForLabel` entry |
| `skills/resolve-conflict/skill.md` | Create — conflict resolution prompt |
| `skills/resolve-conflict/schema.ts` | Create — output Zod schema |
| `skills/resolve-conflict/config.ts` | Create — SkillConfig |
| `skills/resolve-conflict/slice.test.ts` | Create — schema validation tests |
| `slices/resolve-conflict/workflow.ts` | Create — full workflow |
| `slices/resolve-conflict/slice.test.ts` | Create — workflow tests |
| `slices/resolve-conflict/README.md` | Create — required by FACTORY_RULES |
| `apps/web/src/lib/api.ts` | `approveIssue` returns union type, handles 409 |
| `apps/web/src/components/detail/components/ApprovalGateSection.tsx` | Handle conflict in `onSuccess` |
| `apps/web/src/components/detail/components/ApprovalGateSection.test.tsx` | Add conflict banner test |
| `apps/web/src/lib/lanes.config.ts` | Add `factory:merge-conflict` to review lane |
| `apps/web/src/lib/lanes.config.test.ts` | Add spot-check for new state |
| `apps/web/src/lib/constants.ts` | Add state label + `CODE_ACTIVE_STATES` entry |

---

## Task 1: State machine — `factory:merge-conflict`

**Files:**
- Modify: `core/state-machine/states.ts`
- Modify: `core/state-machine/transitions.ts`
- Modify: `core/state-machine/states.test.ts`
- Modify: `core/state-machine/transitions.test.ts`

- [ ] **Step 1: Write the failing tests**

In `core/state-machine/states.test.ts`, replace the existing `'has exactly 24 canonical states'` test and update the full list:

```ts
it('has exactly 25 canonical states', () => {
  expect(STATES).toHaveLength(25);
});

it('contains all canonical factory:* states in order', () => {
  expect([...STATES]).toStrictEqual([
    'factory:triaging',
    'factory:accepted',
    'factory:rejected',
    'factory:grilling',
    'factory:prd-drafting',
    'factory:prd-review',
    'factory:decomposing',
    'factory:issues-created',
    'factory:research-pending',
    'factory:research-complete',
    'factory:investigating',
    'factory:investigation-complete',
    'factory:gate-pending',
    'factory:dev-ready',
    'factory:in-progress',
    'factory:needs-qa',
    'factory:qa-failed',
    'factory:needs-review',
    'factory:needs-fix',
    'factory:approved',
    'factory:merge-conflict',
    'factory:retrospecting',
    'factory:needs-human',
    'factory:done',
    'factory:archived',
  ]);
});
```

Append to `core/state-machine/transitions.test.ts` (inside the happy-paths describe):

```ts
// merge-conflict path
it('approved → merge-conflict', () =>
  expect(isLegalTransition('factory:approved', 'factory:merge-conflict')).toBe(true));
it('merge-conflict → done', () =>
  expect(isLegalTransition('factory:merge-conflict', 'factory:done')).toBe(true));
it('merge-conflict → needs-human', () =>
  expect(isLegalTransition('factory:merge-conflict', 'factory:needs-human')).toBe(true));
```

Also add an illegal-transition test:

```ts
it('merge-conflict → in-progress is illegal', () =>
  expect(isLegalTransition('factory:merge-conflict', 'factory:in-progress')).toBe(false));
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @goose-hub/core test core/state-machine/states.test.ts core/state-machine/transitions.test.ts
```

Expected: FAIL — `expect(received).toHaveLength(25)` received 24; transition tests fail on unknown state.

- [ ] **Step 3: Update `states.ts`**

In `core/state-machine/states.ts`, add `'factory:merge-conflict'` after `'factory:approved'`:

```ts
export const STATES = Object.freeze([
  'factory:triaging',
  'factory:accepted',
  'factory:rejected',
  'factory:grilling',
  'factory:prd-drafting',
  'factory:prd-review',
  'factory:decomposing',
  'factory:issues-created',
  'factory:research-pending',
  'factory:research-complete',
  'factory:investigating',
  'factory:investigation-complete',
  'factory:gate-pending',
  'factory:dev-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:needs-human',
  'factory:done',
  'factory:archived',
] as const);

export type StateName = (typeof STATES)[number];
export type State = StateName;
```

- [ ] **Step 4: Update `transitions.ts`**

In `core/state-machine/transitions.ts`, update `factory:approved` and add `factory:merge-conflict`:

```ts
'factory:approved': ['factory:retrospecting', 'factory:merge-conflict'],
'factory:merge-conflict': ['factory:done', 'factory:needs-human'],
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/core test core/state-machine/states.test.ts core/state-machine/transitions.test.ts
```

Expected: PASS — all state and transition tests green.

- [ ] **Step 6: Commit**

```bash
git add core/state-machine/states.ts core/state-machine/transitions.ts core/state-machine/states.test.ts core/state-machine/transitions.test.ts
git commit -m "feat(state-machine): add factory:merge-conflict state and transitions"
```

---

## Task 2: `MergeConflictError` + 405 detection in `merge-pr.ts`

**Files:**
- Modify: `core/connectors/github/merge-pr.ts`
- Modify: `core/connectors/github/slice.test.ts`

- [ ] **Step 1: Write the failing tests**

In `core/connectors/github/slice.test.ts`, inside the existing `describe('mergePR (#186)')` block, add:

```ts
it('throws MergeConflictError on 405', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Pull Request is not mergeable' }),
        { status: 405, statusText: 'Method Not Allowed' },
      ),
    ) as unknown as typeof fetch;
  await expect(
    mergePR({ repo: 'owner/repo', prNumber: 42, token: 'ghp_test', fetchImpl }),
  ).rejects.toThrow(MergeConflictError);
});

it('MergeConflictError carries the prNumber', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('not mergeable', { status: 405, statusText: 'Method Not Allowed' }),
    ) as unknown as typeof fetch;
  const err = await mergePR({ repo: 'owner/repo', prNumber: 77, token: 'ghp_test', fetchImpl }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MergeConflictError);
  expect((err as MergeConflictError).prNumber).toBe(77);
});

it('still throws generic Error on other non-2xx (e.g. 403)', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('rate limited', { status: 403, statusText: 'Forbidden' }),
    ) as unknown as typeof fetch;
  const err = await mergePR({ repo: 'owner/repo', prNumber: 1, token: 'ghp_test', fetchImpl }).catch(
    (e: unknown) => e,
  );
  expect(err).not.toBeInstanceOf(MergeConflictError);
  expect(String(err)).toContain('403');
});
```

Also update the import at the top to include `MergeConflictError`:

```ts
import { MergeConflictError, mergePR } from './merge-pr.js';
```

Update the existing `'throws on non-2xx'` test to verify 405 is now a `MergeConflictError` not a generic error (the existing test uses 405 — it now needs to expect `MergeConflictError`):

```ts
it('throws MergeConflictError (not generic Error) on 405', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('not mergeable', { status: 405, statusText: 'Method Not Allowed' }),
    ) as unknown as typeof fetch;
  await expect(
    mergePR({ repo: 'owner/repo', prNumber: 99, token: 'ghp_test', fetchImpl }),
  ).rejects.toBeInstanceOf(MergeConflictError);
});
```

Replace the old `'throws on non-2xx'` test with the above (the old test used 405 and would now fail because `MergeConflictError extends Error` — but we want to assert the specific type).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @goose-hub/core test core/connectors/github/slice.test.ts
```

Expected: FAIL — `MergeConflictError` is not exported yet.

- [ ] **Step 3: Update `merge-pr.ts`**

Replace the entire file at `core/connectors/github/merge-pr.ts`:

```ts
export class MergeConflictError extends Error {
  constructor(public prNumber: number) {
    super(`PR #${prNumber} is not mergeable (merge conflict)`);
    this.name = 'MergeConflictError';
  }
}

export interface MergePrInput {
  repo: string;
  prNumber: number;
  token: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  fetchImpl?: typeof fetch;
}

export interface MergePrResult {
  sha: string;
  merged: boolean;
}

export async function mergePR(input: MergePrInput): Promise<MergePrResult> {
  const { repo, prNumber, token, mergeMethod = 'merge', fetchImpl = fetch } = input;
  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ merge_method: mergeMethod }),
  });

  if (response.status === 405) {
    throw new MergeConflictError(prNumber);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '<no body>');
    throw new Error(
      `GitHub PR merge failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const json = (await response.json()) as { sha: string; merged: boolean };
  return { sha: json.sha, merged: json.merged };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/core test core/connectors/github/slice.test.ts
```

Expected: PASS — all mergePR tests green.

- [ ] **Step 5: Commit**

```bash
git add core/connectors/github/merge-pr.ts core/connectors/github/slice.test.ts
git commit -m "feat(merge-pr): typed MergeConflictError on GitHub 405"
```

---

## Task 3: `approveIssue` catches conflict + transitions + emits event

**Files:**
- Modify: `apps/server/src/domains/issues/transitions.ts`
- Modify: `apps/server/src/domains/issues/service.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/src/domains/issues/service.test.ts`, inside the existing `describe('approveIssue / rejectIssue (#186)')` block, add:

```ts
it('approveIssue returns 409 and transitions to merge-conflict when GitHub 405', async () => {
  vi.mocked(eventStore.replay).mockReturnValueOnce([
    {
      id: 1,
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
      kind: 'pr.opened',
      runId: 'run-1',
      payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42', branch: 'factory/run-1' },
      createdAt: '2026-05-05T10:00:00Z',
    },
  ] as never);

  const { MergeConflictError } = await import('@goose-hub/core/connectors/github/merge-pr.js');
  const mergePRImpl = vi.fn().mockRejectedValueOnce(new MergeConflictError(42));

  const { approveIssue } = await import('./service.js');
  const result = await approveIssue('proj', '1', { mergePRImpl });

  expect(result).toMatchObject({ ok: false, status: 409, error: 'merge-conflict' });
  expect(mockSource.transitionState).toHaveBeenCalledWith('1', 'factory:approved', 'factory:merge-conflict');
  const conflictEvent = vi
    .mocked(eventStore.appendEvent)
    .mock.calls.find(([e]) => e.kind === 'merge.conflict');
  expect(conflictEvent).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/service.test.ts
```

Expected: FAIL — `approveIssue` does not currently handle `MergeConflictError`.

- [ ] **Step 3: Update `transitions.ts`**

In `apps/server/src/domains/issues/transitions.ts`, add the import for `MergeConflictError` at the top:

```ts
import {
  MergeConflictError,
  mergePR as defaultMergePR,
} from '@goose-hub/core/connectors/github/merge-pr.js';
```

Replace the `mergePR` call and the section after it in `approveIssue`:

```ts
  let merged: { sha: string; merged: boolean };
  try {
    merged = await mergePR({ repo: repoRef, prNumber, token });
  } catch (err) {
    if (err instanceof MergeConflictError) {
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'merge.conflict',
        payload: { prNumber },
      });
      await source.transitionState(id, 'factory:approved', 'factory:merge-conflict');
      return { ok: false, error: 'merge-conflict', status: 409 };
    }
    throw err;
  }
```

The rest of `approveIssue` (event emitting, state transition to done, comment) remains unchanged — it now only runs on the successful `merged` path.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/service.test.ts
```

Expected: PASS — all approve/reject tests green including the new conflict test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/issues/transitions.ts apps/server/src/domains/issues/service.test.ts
git commit -m "feat(approve): catch MergeConflictError, transition to factory:merge-conflict, return 409"
```

---

## Task 4: Router 409 + `dispatchResolveConflict`

**Files:**
- Modify: `apps/server/src/domains/issues/router.ts`
- Modify: `apps/server/src/domains/issues/router.test.ts`
- Modify: `apps/server/src/shared/dispatch.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/domains/issues/router.test.ts`, inside the existing `describe('POST /projects/:slug/issues/:id/approve')` block, add:

```ts
it('returns 409 and calls dispatchResolveConflict when merge conflict detected', async () => {
  mockApproveIssue.mockResolvedValue({
    ok: false,
    error: 'merge-conflict',
    status: 409,
  });

  const app = makeApp();
  const res = await app.request('/projects/my-project/issues/42/approve', { method: 'POST' });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe('merge-conflict');
  expect(mockDispatchResolveConflict).toHaveBeenCalledWith('my-project', 42);
});
```

At the top of the test file, add a mock for `dispatchResolveConflict` alongside the existing dispatch mocks. Find the existing mock setup (where `dispatchQa`, `dispatchReview` are mocked — they're in the shared dispatch module) and add:

```ts
const mockDispatchResolveConflict = vi.fn().mockResolvedValue(undefined);
```

Add it to the dispatch mock factory. The exact location depends on how `dispatch.ts` is mocked in `router.test.ts`. Check the existing mock pattern and add `dispatchResolveConflict` to the same mock object:

```ts
vi.mock('#shared/dispatch.js', () => ({
  dispatchForIssue: mockDispatchForIssue,
  dispatchQa: mockDispatchQa,
  dispatchReview: mockDispatchReview,
  dispatchResolveConflict: mockDispatchResolveConflict,
}));
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/router.test.ts
```

Expected: FAIL — `mockDispatchResolveConflict` not called; 409 cast fails.

- [ ] **Step 3: Add `dispatchResolveConflict` to `dispatch.ts`**

In `apps/server/src/shared/dispatch.ts`, add after `dispatchReview`:

```ts
export async function dispatchResolveConflict(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchResolveConflict: already in-flight, dropping duplicate', {
      slug,
      issueNumber,
    });
    return;
  }
  _issueInFlight.add(key);
  try {
    const { runResolveConflictWorkflow } = (await import(
      new URL('../../../../slices/resolve-conflict/workflow.js', import.meta.url).href
    )) as {
      runResolveConflictWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchResolveConflict: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runResolveConflictWorkflow(item, source, slug, REPO_ROOT);
  } finally {
    _issueInFlight.delete(key);
  }
}
```

In `dispatchForLabel`, add before the final `logger.info`:

```ts
if (labelName === 'factory:merge-conflict') {
  await dispatchResolveConflict(slug, issueNumber);
  return;
}
```

- [ ] **Step 4: Update `router.ts`**

In `apps/server/src/domains/issues/router.ts`, add `dispatchResolveConflict` to the dispatch import, and update the approve route handler:

```ts
import { dispatchForIssue, dispatchQa, dispatchReview, dispatchResolveConflict } from '#shared/dispatch.js';
```

Replace the approve route:

```ts
router.post('/:slug/issues/:id/approve', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const result = await approveIssue(slug, id);
  if (!result.ok && result.error === 'merge-conflict') {
    dispatchResolveConflict(slug, Number(id)).catch((err: unknown) => {
      logger.error('dispatchResolveConflict failed', { slug, id, error: String(err) });
    });
  }
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409 | 500);
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/shared/dispatch.ts apps/server/src/domains/issues/router.ts apps/server/src/domains/issues/router.test.ts
git commit -m "feat(dispatch): add dispatchResolveConflict, router fires it on 409"
```

---

## Task 5: `skills/resolve-conflict/` — prompt, schema, config

**Files:**
- Create: `skills/resolve-conflict/skill.md`
- Create: `skills/resolve-conflict/schema.ts`
- Create: `skills/resolve-conflict/config.ts`
- Create: `skills/resolve-conflict/slice.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `skills/resolve-conflict/slice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ResolveConflictSchema } from './schema.js';

describe('ResolveConflictSchema', () => {
  it('accepts valid output with all resolved', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: ['src/foo.ts', 'src/bar.ts'],
      unresolvable: [],
      confidence: 'high',
      decisionSummaries: [{ step: 'resolve', summary: 'Merged both sides of foo.ts cleanly' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid output with unresolvable files', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: ['src/foo.ts'],
      unresolvable: ['src/complex.ts'],
      confidence: 'low',
      decisionSummaries: [{ step: 'resolve', summary: 'complex.ts has semantic conflicts' }],
    });
    expect(result.success).toBe(true);
  });

  it('requires at least one decisionSummary', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: [],
      unresolvable: [],
      confidence: 'medium',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid confidence', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: [],
      unresolvable: [],
      confidence: 'very-high',
      decisionSummaries: [{ step: 'x', summary: 'y' }],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @goose-hub/skills test skills/resolve-conflict/slice.test.ts
```

Expected: FAIL — `schema.ts` does not exist.

- [ ] **Step 3: Create `schema.ts`**

Create `skills/resolve-conflict/schema.ts`:

```ts
import { z } from 'zod';

const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const ResolveConflictContextSchema = z.object({
  worktreePath: z.string().describe('Absolute path to the worktree with conflict markers present'),
  conflictedFiles: z.array(z.string()).describe('Workspace-relative paths of conflicted files'),
  baseBranch: z.string().describe('Branch that was merged in (e.g. main)'),
  prNumber: z.number().int(),
});

export const ResolveConflictSchema = z.object({
  resolved: z
    .array(z.string())
    .describe('Workspace-relative paths of files the agent successfully resolved'),
  unresolvable: z
    .array(z.string())
    .describe('Workspace-relative paths of files the agent could not resolve'),
  confidence: z.enum(['low', 'medium', 'high']),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type ResolveConflictOutput = z.infer<typeof ResolveConflictSchema>;
```

- [ ] **Step 4: Create `config.ts`**

Create `skills/resolve-conflict/config.ts`:

```ts
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { ResolveConflictContextSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: ResolveConflictContextSchema,
  contextAllowlist: ['worktreePath', 'conflictedFiles', 'baseBranch', 'prNumber'],
  toolBundles: ['dev-tools'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
```

- [ ] **Step 5: Create `skill.md`**

Create `skills/resolve-conflict/skill.md`:

```markdown
You are resolving git merge conflicts in a repository worktree.

The working directory already contains files with git conflict markers — `git merge` has already been run. Do NOT run git commands yourself. Only read and write files.

## Your task

For each file in `conflictedFiles`:
1. Read the full file content including conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. Understand what BOTH sides are trying to achieve semantically
3. Write a resolved version that correctly combines both changes — do NOT simply pick one side unless one side genuinely supersedes the other
4. Verify the written file contains zero conflict marker lines

## Output

Return a JSON object matching this schema:
- `resolved`: array of file paths you successfully resolved
- `unresolvable`: array of file paths where you could not produce a confident resolution (e.g. the two sides make mutually exclusive structural changes)
- `confidence`: `"low"` | `"medium"` | `"high"` — your confidence in the overall resolution
- `decisionSummaries`: at least one entry describing your approach

If `unresolvable` is non-empty, explain why in the relevant `decisionSummaries` entry.
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/skills test skills/resolve-conflict/slice.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/resolve-conflict/
git commit -m "feat(skills): add resolve-conflict skill (schema, config, prompt)"
```

---

## Task 6: `slices/resolve-conflict/` — workflow

**Files:**
- Create: `slices/resolve-conflict/workflow.ts`
- Create: `slices/resolve-conflict/slice.test.ts`
- Create: `slices/resolve-conflict/README.md`

- [ ] **Step 1: Create `README.md`**

Create `slices/resolve-conflict/README.md`:

```markdown
# resolve-conflict slice

Triggered when `factory:merge-conflict` label is set (GitHub 405 on merge).

## Workflow

1. Replay events → find `pr.opened` → get `branch`, `baseBranch`, `prNumber`, `prUrl`
2. Create git worktree checked out at the PR branch
3. `git fetch origin && git merge origin/<baseBranch>` — materialises conflict markers
4. If no conflicts (race: cleared before agent ran) → skip to step 6
5. Run `resolve-conflict` Claude agent with worktree path + conflicted file list
6. `git add -A && git commit && git push origin <branch>`
7. Call `mergePR` via GitHub connector
8. Success → emit events, `factory:merge-conflict → factory:done`, post comment
9. Any failure → emit `merge.conflict-unresolvable`, `factory:merge-conflict → factory:needs-human`, post comment with PR URL

## Tests

`slice.test.ts` covers: happy path, no pr.opened event, agent failure, mergePR failure.
```

- [ ] **Step 2: Write the failing workflow tests**

Create `slices/resolve-conflict/slice.test.ts`:

```ts
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { MergeConflictError } from '@goose-hub/core/connectors/github/merge-pr.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn().mockReturnValue({ id: 1 }), replay: vi.fn().mockReturnValue([]) },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'proj/developer/0' }),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('# mock skill prompt'),
    mkdirSync: vi.fn(),
  };
});
const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runResolveConflictWorkflow } from './workflow.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Fix bug',
    body: 'Fix the bug',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:merge-conflict',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeStateSource(): StateSource {
  return {
    projectId: 'proj',
    repoRef: 'owner/repo',
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn(),
    watchForUpdates: vi.fn(),
  };
}

const PR_OPENED_EVENT = {
  id: 1,
  projectId: 'proj',
  workItemId: 'github:owner/repo#42',
  kind: 'pr.opened',
  runId: 'run-1',
  payload: {
    prNumber: 99,
    prUrl: 'https://github.com/owner/repo/pull/99',
    branch: 'factory/run-1',
    baseBranch: 'main',
    devRunId: 'run-1',
  },
  createdAt: '2026-05-05T10:00:00Z',
};

const SUCCESS_AGENT_OUTPUT: AgentResult = {
  output: {
    resolved: ['src/foo.ts'],
    unresolvable: [],
    confidence: 'high',
    decisionSummaries: [{ step: 'resolve', summary: 'Merged both changes in foo.ts' }],
  },
  decisionSummaries: [],
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'ghp_test';
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe('runResolveConflictWorkflow', () => {
  it('no pr.opened event → transitions to needs-human and posts comment', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {});
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('no pr.opened event'),
    );
  });

  it('happy path: resolves conflicts, pushes, merges, transitions to done', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => { throw new Error('merge conflict'); }) // merge fails = conflict
      .mockReturnValueOnce('src/foo.ts\n') // diff --name-only --diff-filter=U
      .mockReturnValueOnce('') // add -A
      .mockReturnValueOnce('') // commit
      .mockReturnValueOnce('') // push
      .mockReturnValueOnce(''); // worktree remove

    mockClaudeCliRun.mockResolvedValueOnce(SUCCESS_AGENT_OUTPUT);
    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc123', merged: true });

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', prNumber: 99 }),
    );
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:done',
    );
    const resolvedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'merge.conflict-resolved');
    expect(resolvedEvent).toBeDefined();
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('resolved automatically'),
    );
  });

  it('agent returns unresolvable files → transitions to needs-human', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => { throw new Error('conflict'); }) // merge fails
      .mockReturnValueOnce('src/hard.ts\n') // conflicted files
      .mockReturnValueOnce(''); // worktree remove

    const agentOutput: AgentResult = {
      output: {
        resolved: [],
        unresolvable: ['src/hard.ts'],
        confidence: 'low',
        decisionSummaries: [{ step: 'resolve', summary: 'Could not resolve hard.ts' }],
      },
      decisionSummaries: [],
      events: [],
    };
    mockClaudeCliRun.mockResolvedValueOnce(agentOutput);
    const mergePRImpl = vi.fn();

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('https://github.com/owner/repo/pull/99'),
    );
  });

  it('mergePR throws → transitions to needs-human', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // clean merge (no conflict)
      .mockReturnValueOnce('') // push
      .mockReturnValueOnce(''); // worktree remove

    const mergePRImpl = vi.fn().mockRejectedValueOnce(new Error('GitHub 422 — PR already merged'));

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      mergePRImpl,
      gitExecImpl,
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm test slices/resolve-conflict/slice.test.ts
```

Expected: FAIL — `workflow.ts` does not exist.

- [ ] **Step 4: Create `workflow.ts`**

Create `slices/resolve-conflict/workflow.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import {
  type MergePrInput,
  MergeConflictError,
  mergePR as defaultMergePR,
} from '@goose-hub/core/connectors/github/merge-pr.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import config from '@goose-hub/skills/resolve-conflict/config.js';
import { ResolveConflictSchema } from '@goose-hub/skills/resolve-conflict/schema.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const REPO_ROOT = join(import.meta.dirname, '../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

type GitExec = (args: string[], cwd: string) => string;

function defaultGitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

export interface ResolveConflictDeps {
  runtime?: AgentRuntime;
  mergePRImpl?: (input: MergePrInput) => Promise<{ sha: string; merged: boolean }>;
  gitExecImpl?: GitExec;
}

export async function runResolveConflictWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  slug: string,
  repoRoot: string,
  deps: ResolveConflictDeps = {},
): Promise<void> {
  const {
    runtime: runtimeOverride,
    mergePRImpl = defaultMergePR,
    gitExecImpl = defaultGitExec,
  } = deps;

  const workItemId = workItem.id;
  const issueNumber = workItem.externalId;
  const repoRef = workItem.repoRef ?? slug;

  // Find most recent pr.opened event
  const events = eventStore.replay({ workItemId });
  const prEvent = [...events].reverse().find((e) => e.kind === 'pr.opened');
  if (prEvent == null) {
    await stateSource.transitionState(issueNumber, 'factory:merge-conflict', 'factory:needs-human');
    await stateSource.comment(
      issueNumber,
      'Agent could not resolve merge conflict: no pr.opened event found.',
    );
    return;
  }

  const { branch, baseBranch = 'main', prNumber, prUrl } = prEvent.payload as {
    branch: string;
    baseBranch?: string;
    prNumber: number;
    prUrl: string;
  };

  const runId = crypto.randomUUID();
  const wtPath = join(WORKSPACES_DIR, runId);
  mkdirSync(WORKSPACES_DIR, { recursive: true });

  try {
    // Create worktree on PR branch (not detached — we need to commit)
    gitExecImpl(['worktree', 'add', wtPath, branch], repoRoot);

    // Fetch + attempt merge
    gitExecImpl(['fetch', 'origin'], wtPath);

    let hasMergeConflicts = false;
    try {
      gitExecImpl(['merge', `origin/${baseBranch}`], wtPath);
    } catch {
      hasMergeConflicts = true;
    }

    if (hasMergeConflicts) {
      const conflictedOutput = gitExecImpl(
        ['diff', '--name-only', '--diff-filter=U'],
        wtPath,
      );
      const conflictedFiles = conflictedOutput
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      if (conflictedFiles.length > 0) {
        const { personaId } = selectPersona(slug, 'developer');
        const runtime = runtimeOverride ?? new ClaudeCliRuntime();

        const agentResult = await runtime.run({
          runId,
          role: 'developer',
          skill: 'resolve-conflict',
          context: {
            worktreePath: wtPath,
            conflictedFiles,
            baseBranch,
            prNumber,
          },
          contextAllowlist: config.contextAllowlist ?? [],
          freshContext: false,
          toolBundles: config.toolBundles,
          toolExtras: [],
          budgets: { maxTurns: 20, maxBudgetUsd: 2 },
          personaId,
          outputJsonSchema: toJsonSchema(ResolveConflictSchema),
          appendSystemPrompt: readPrompt('resolve-conflict'),
          workspaceDir: wtPath,
        });

        const parsed = ResolveConflictSchema.safeParse(agentResult.output);
        if (!parsed.success || parsed.data.unresolvable.length > 0) {
          const reason = !parsed.success
            ? 'Agent output failed schema validation'
            : `Agent could not resolve: ${parsed.data.unresolvable.join(', ')}`;
          throw new Error(reason);
        }

        // Commit the resolved files
        gitExecImpl(['add', '-A'], wtPath);
        gitExecImpl(
          ['commit', '-m', `chore: resolve merge conflicts with ${baseBranch}`],
          wtPath,
        );
      }
    }

    // Push branch
    gitExecImpl(['push', 'origin', `HEAD:refs/heads/${branch}`], wtPath);

    // Re-merge the PR
    const token = process.env.GITHUB_TOKEN ?? '';
    const merged = await mergePRImpl({ repo: repoRef, prNumber, token });

    // Emit success events
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge.conflict-resolved',
      payload: { prNumber, sha: merged.sha },
    });
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'gate.approved',
      payload: { source: 'conflict-resolver', prNumber },
    });
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'pr.merged',
      payload: { prNumber, sha: merged.sha },
    });

    await stateSource.transitionState(issueNumber, 'factory:merge-conflict', 'factory:done');
    await stateSource.comment(
      issueNumber,
      `Merge conflict resolved automatically by agent; PR #${prNumber} merged (${merged.sha}).`,
    );
  } catch (err: unknown) {
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge.conflict-unresolvable',
      payload: { prNumber, prUrl, error: String(err) },
    });
    await stateSource.transitionState(issueNumber, 'factory:merge-conflict', 'factory:needs-human');
    await stateSource.comment(
      issueNumber,
      `Agent could not resolve merge conflict automatically. Manual merge required: ${prUrl}`,
    );
  } finally {
    try {
      gitExecImpl(['worktree', 'remove', '--force', wtPath], repoRoot);
    } catch {
      // best-effort cleanup
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test slices/resolve-conflict/slice.test.ts
```

Expected: PASS — all 4 workflow tests green.

- [ ] **Step 6: Commit**

```bash
git add slices/resolve-conflict/
git commit -m "feat(slices): add resolve-conflict workflow"
```

---

## Task 7: Web — `api.ts` + `ApprovalGateSection`

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/detail/components/ApprovalGateSection.tsx`
- Modify: `apps/web/src/components/detail/components/ApprovalGateSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/detail/components/ApprovalGateSection.test.tsx`, add a new test and update the existing error test:

Replace the existing `'shows API error when approve fails'` test with two tests:

```ts
it('shows conflict banner (not error) when approve returns conflict', async () => {
  vi.mocked(approveIssue).mockResolvedValueOnce({ ok: false, conflict: true });
  render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
  fireEvent.click(screen.getByTestId('approve-btn'));
  await waitFor(() => {
    expect(screen.getByTestId('conflict-banner')).toBeTruthy();
    // Error banner should NOT be shown
    expect(screen.queryByTestId('approval-gate-error')).toBeNull();
  });
});

it('shows API error when approve fails with a non-conflict error', async () => {
  vi.mocked(approveIssue).mockRejectedValueOnce(new Error('GitHub API unavailable'));
  render_(<ApprovalGateSection projectSlug="proj" id="42" state="factory:approved" />);
  fireEvent.click(screen.getByTestId('approve-btn'));
  await waitFor(() => {
    const el = screen.getByTestId('approval-gate-error');
    expect(el.textContent).toContain('GitHub API unavailable');
  });
});
```

Update the mock type at the top of the test file:

```ts
vi.mock('@/lib/api', () => ({
  approveIssue: vi.fn(),
  rejectIssue: vi.fn(),
}));
```

The mock return type for `approveIssue` must now accommodate `{ ok: false; conflict: true }` — TypeScript will accept this since `vi.fn()` is loosely typed.

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @goose-hub/web test apps/web/src/components/detail/components/ApprovalGateSection.test.tsx
```

Expected: FAIL — `conflict-banner` test ID does not exist; mock type mismatch.

- [ ] **Step 3: Update `api.ts`**

Replace the `approveIssue` function in `apps/web/src/lib/api.ts`:

```ts
export async function approveIssue(
  slug: string,
  id: string,
): Promise<{ ok: true; sha: string; prNumber: number } | { ok: false; conflict: true }> {
  const res = await fetch(`/api/projects/${slug}/issues/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 409) return { ok: false, conflict: true };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `POST /projects/${slug}/issues/${id}/approve failed: ${res.status} ${res.statusText} ${text}`,
    );
  }
  return (await res.json()) as { ok: true; sha: string; prNumber: number };
}
```

- [ ] **Step 4: Update `ApprovalGateSection.tsx`**

Replace the `approveMutation` definition and the error display in `ApprovalGateSection.tsx`:

```tsx
const [conflictMsg, setConflictMsg] = useState<string | null>(null);

const approveMutation = useMutation({
  mutationFn: () => approveIssue(projectSlug, id),
  onSuccess: (result) => {
    if (!result.ok) {
      setConflictMsg('Merge conflict detected — agent is resolving…');
      return;
    }
    invalidate();
  },
  onError: (err: unknown) => {
    setErrorMsg(err instanceof Error ? err.message : String(err));
  },
});
```

Add `conflictMsg` state declaration alongside the existing state declarations at the top of the component.

In the JSX, replace the existing error block:

```tsx
{conflictMsg != null ? (
  <div data-testid="conflict-banner" className="mb-2 text-[12px] text-fg-2">
    {conflictMsg}
  </div>
) : null}

{errorMsg != null ? (
  <div data-testid="approval-gate-error" className="mb-2 text-[12px] text-red-400">
    {errorMsg}
  </div>
) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/web test apps/web/src/components/detail/components/ApprovalGateSection.test.tsx
```

Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/detail/components/ApprovalGateSection.tsx apps/web/src/components/detail/components/ApprovalGateSection.test.tsx
git commit -m "feat(web): detect 409 conflict response, show agent-resolving banner"
```

---

## Task 8: UI — lanes + constants

**Files:**
- Modify: `apps/web/src/lib/lanes.config.ts`
- Modify: `apps/web/src/lib/lanes.config.test.ts`
- Modify: `apps/web/src/lib/constants.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/lanes.config.test.ts`, add a spot-check assertion inside the existing `'every state in the state machine maps to exactly one lane'` test:

```ts
expect(laneForState('factory:merge-conflict')).toBe('review');
```

Note: the existing `'has 11 lanes with 2 hidden by default'` test count assertion (11) does NOT change — `factory:merge-conflict` goes into the existing review lane.

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @goose-hub/web test apps/web/src/lib/lanes.config.test.ts
```

Expected: FAIL — `laneForState('factory:merge-conflict')` returns `undefined`.

- [ ] **Step 3: Update `lanes.config.ts`**

In `apps/web/src/lib/lanes.config.ts`, update the `review` lane's states array:

```ts
{
  key: 'review',
  label: 'Review',
  states: ['factory:needs-review', 'factory:approved', 'factory:merge-conflict'],
  hiddenByDefault: false,
},
```

- [ ] **Step 4: Update `constants.ts`**

In `apps/web/src/lib/constants.ts`, add the new state label inside `STATE_LABEL`:

```ts
'factory:merge-conflict': 'merge-conflict',
```

Add it to `CODE_ACTIVE_STATES`:

```ts
export const CODE_ACTIVE_STATES = new Set([
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:done',
]);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/web test apps/web/src/lib/lanes.config.test.ts apps/web/src/lib/constants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Full test + typecheck pass**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: All three pass with zero errors. Fix any TypeScript errors before proceeding.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/lanes.config.ts apps/web/src/lib/lanes.config.test.ts apps/web/src/lib/constants.ts
git commit -m "feat(ui): add factory:merge-conflict to review lane and constants"
```

---

## Self-Review Checklist

- [x] **State machine** — `factory:merge-conflict` added in states.ts and transitions.ts, tests updated
- [x] **MergeConflictError** — typed 405 detection in merge-pr.ts, test coverage for all paths
- [x] **approveIssue** — catches conflict, transitions state, emits event, returns 409
- [x] **Router** — 409 handled, `dispatchResolveConflict` fired fire-and-forget
- [x] **dispatch.ts** — `dispatchResolveConflict` + `dispatchForLabel` entry for recovery
- [x] **Skill** — schema, config, prompt all created and tested
- [x] **Workflow** — happy path, no-pr-event, agent-failure, mergePR-failure all tested
- [x] **Client** — 409 detected in api.ts, conflict banner shown, error path preserved
- [x] **UI constants** — new state labelled and in CODE_ACTIVE_STATES
- [x] **Lanes** — merge-conflict in review lane, lane count unchanged at 11
- [x] **Events** — merge.conflict, merge.conflict-resolved, merge.conflict-unresolvable all emitted correctly
- [x] **Failure comment** — includes PR URL so human can merge manually
