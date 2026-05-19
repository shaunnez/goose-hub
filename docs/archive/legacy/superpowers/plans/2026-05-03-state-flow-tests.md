# State Flow Integration & E2E Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 Vitest integration tests (Layer A state-path + Layer B dispatch-chain) and 2 Playwright e2e pipeline scenarios that prove the dispatch chain, state transitions, and UI work end-to-end with mocked agents.

**Architecture:** Layer A tests call workflow functions directly with a mocked `ClaudeCliRuntime` and `StateSource`. Layer B tests fire the real Hono webhook handler with the same mocks, using `vi.waitFor` to wait for the fire-and-forget dispatch chain. Playwright tests boot the server with `MOCK_AGENTS=true` / `MOCK_OPEN_PR=true` env vars and drive a real browser through the full pipeline UI.

**Tech Stack:** Node.js + TypeScript, Vitest 3, Playwright, Hono `app.request()`, `vi.mock`, `vi.waitFor`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `core/agent-runtime/mock-outputs.ts` | Create | Preset skill outputs for MOCK_AGENTS mode |
| `core/agent-runtime/claude-cli.ts` | Modify | Add MOCK_AGENTS early return in `run()` |
| `apps/server/src/shared/dispatch.ts` | Modify | Inject mock openPR when `MOCK_OPEN_PR=true` |
| `apps/server/src/domains/workflows/state-flows.test.ts` | Create | All integration tests (Layer A + B) |
| `apps/web/playwright-e2e-pipeline.config.ts` | Create | Playwright config with MOCK_AGENTS env |
| `apps/web/e2e/pipeline/state-flow.spec.ts` | Create | Playwright e2e test (2 scenarios) |

---

## Task 1: Create `core/agent-runtime/mock-outputs.ts`

**Files:**
- Create: `core/agent-runtime/mock-outputs.ts`

- [ ] **Step 1: Read the AgentResult interface and AgentSpec interface**

Run: `grep -n "AgentResult\|AgentSpec" core/agent-runtime/interface.ts`

You need the exact shape of `AgentResult` (output, decisionSummaries, events) and `AgentSpec` (skill field name) before writing code.

- [ ] **Step 2: Create `core/agent-runtime/mock-outputs.ts`**

```typescript
import type { AgentResult, AgentSpec } from './interface.js';

export function resolveMockOutput(spec: AgentSpec): AgentResult {
  switch (spec.skill) {
    case 'triage':
      return {
        output: {
          type: 'chore',
          priority: 'p3',
          labels: [],
          reasoning: 'e2e fixture',
          decisionSummaries: [{ step: 'classify', summary: 'Classified as chore for e2e' }],
        },
        decisionSummaries: [{ step: 'classify', summary: 'Classified as chore for e2e' }],
        events: [],
      };

    case 'repo-match':
      return {
        output: {
          candidates: [{ repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1 }],
          decisionSummaries: [],
        },
        decisionSummaries: [],
        events: [],
      };

    case 'implement':
      return {
        output: {
          plan: 'E2E mock plan',
          filesWritten: [{ path: 'e2e-mock.ts', reason: 'e2e fixture' }],
          testsWritten: [],
          prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
          evidenceSpecPath: null,
          confidence: 'high',
          decisionSummaries: [{ step: 'implement', summary: 'Mock implementation for e2e test' }],
        },
        decisionSummaries: [{ step: 'implement', summary: 'Mock implementation for e2e test' }],
        events: [],
      };

    case 'investigate':
      return {
        output: {
          findings: 'E2E mock findings',
          keyFiles: [],
          confidence: 'high',
          openQuestions: [],
          decisionSummaries: [{ step: 'investigate', summary: 'Mock investigation for e2e test' }],
        },
        decisionSummaries: [{ step: 'investigate', summary: 'Mock investigation for e2e test' }],
        events: [],
      };

    case 'qa':
      return {
        output: {
          verdict: 'pass',
          tier: 'functional',
          criteriaResults: [],
          decisionSummaries: [{ step: 'qa', summary: 'Mock QA pass for e2e test' }],
        },
        decisionSummaries: [{ step: 'qa', summary: 'Mock QA pass for e2e test' }],
        events: [],
      };

    case 'review':
      return {
        output: {
          verdict: 'approved',
          feedback: null,
          decisionSummaries: [{ step: 'review', summary: 'Mock review approval for e2e test' }],
        },
        decisionSummaries: [{ step: 'review', summary: 'Mock review approval for e2e test' }],
        events: [],
      };

    default:
      throw new Error(`resolveMockOutput: no preset for skill "${spec.skill}"`);
  }
}
```

> **Note:** If `AgentResult` does not have a `decisionSummaries` field at the top level (it might be nested in `output` only), drop it from the return objects. Match the exact shape from the interface.

- [ ] **Step 3: Run TypeScript type check**

```
pnpm --filter @goose-hub/core tsc --noEmit
```

Expected: no errors. Fix any type mismatches against `AgentResult` / `AgentSpec`.

- [ ] **Step 4: Commit**

```bash
git add core/agent-runtime/mock-outputs.ts
git commit -m "feat(agent-runtime): add resolveMockOutput for MOCK_AGENTS mode"
```

---

## Task 2: Wire `MOCK_AGENTS` into `ClaudeCliRuntime.run()`

**Files:**
- Modify: `core/agent-runtime/claude-cli.ts` (the `run()` method, before the `spawn()` call)

- [ ] **Step 1: Read the `run()` method**

Read `core/agent-runtime/claude-cli.ts` lines 130–180 to find the exact line where `spawn()` is called. You need to inject the early-return BEFORE that line.

- [ ] **Step 2: Add the MOCK_AGENTS import and short-circuit**

At the top of `claude-cli.ts`, add the import:
```typescript
import { resolveMockOutput } from './mock-outputs.js';
```

Inside `run()`, immediately before the `spawn()` call, add:
```typescript
if (process.env.MOCK_AGENTS === 'true') {
  return resolveMockOutput(spec);
}
```

- [ ] **Step 3: Run type check**

```
pnpm --filter @goose-hub/core tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing agent-runtime tests**

```
pnpm --filter @goose-hub/core test
```

Expected: all existing tests pass. The new short-circuit only fires when `MOCK_AGENTS=true` which existing tests do not set.

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/claude-cli.ts core/agent-runtime/mock-outputs.ts
git commit -m "feat(agent-runtime): short-circuit MOCK_AGENTS=true to resolveMockOutput"
```

---

## Task 3: Wire `MOCK_OPEN_PR` into `dispatchFixIssue`

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`

- [ ] **Step 1: Read the current `dispatchFixIssue` function**

Read `apps/server/src/shared/dispatch.ts` and find the `dispatchFixIssue` function (approx. lines 49–67). Note the exact dynamic import call and `runFixIssueWorkflow` invocation.

- [ ] **Step 2: Update the type assertion to include deps**

The dynamic import currently casts `runFixIssueWorkflow` without deps. Update it to:
```typescript
runFixIssueWorkflow: (
  item: unknown,
  source: unknown,
  slug: string,
  repoRoot: string,
  deps?: Record<string, unknown>,
) => Promise<unknown>;
```

- [ ] **Step 3: Add the MOCK_OPEN_PR guard**

Replace the `runFixIssueWorkflow(item, source, slug, REPO_ROOT)` call with:
```typescript
const mockDeps =
  process.env.MOCK_OPEN_PR === 'true'
    ? {
        openPRImpl: () =>
          Promise.resolve({
            prNumber: 999,
            prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
            branch: 'factory/mock-run',
            base: 'main',
          }),
        createWorktreeImpl: () => '/mock/worktree',
        cleanupWorktreeImpl: () => undefined,
        resolveWorktreeHeadShaImpl: () => 'mock-sha-abc123',
      }
    : undefined;
await runFixIssueWorkflow(item, source, slug, REPO_ROOT, mockDeps);
```

- [ ] **Step 4: Run type check**

```
pnpm --filter @goose-hub/server tsc --noEmit
```

Expected: no errors. Fix if the deps type is stricter than `Record<string, unknown>` — check the actual `FixIssueDeps` type in `slices/fix-issue/workflow.ts` and cast accordingly.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/shared/dispatch.ts
git commit -m "feat(dispatch): inject mock openPR/worktree when MOCK_OPEN_PR=true"
```

---

## Task 4: Write `state-flows.test.ts` — infrastructure + Layer A triage tests (3 scenarios)

**Files:**
- Create: `apps/server/src/domains/workflows/state-flows.test.ts`

- [ ] **Step 1: Verify the exact triage-batch.ts state flow**

Read `apps/server/src/domains/workflows/triage-batch.ts` and find every `transitionState` call to confirm:
- `factory:triaging → factory:accepted` (first transition)
- `factory:accepted → factory:dev-ready` | `factory:investigating` | `factory:research-pending` (second transition, based on `TriageOutput.type`)

Also confirm that `type: 'feature'` (not 'chore') routes to `factory:dev-ready`.

- [ ] **Step 2: Verify QA/review transition states**

Read `slices/qa/workflow.ts` lines 140–160 and `slices/review/workflow.ts` lines 100–130. Confirm:
- QA `pass` verdict transitions `factory:needs-qa → factory:needs-review`
- Review `approved` verdict transitions `factory:needs-review → factory:approved`

Note the exact field names for QA output (`verdict`, `tier`, `criteriaResults`) and review output (`verdict`, `feedback`). You will use these in `makeQaOutput` and `makeReviewOutput` helpers.

- [ ] **Step 3: Create the test file with all shared infrastructure**

Create `apps/server/src/domains/workflows/state-flows.test.ts`:

```typescript
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { runTriageBatch } from './triage-batch.js';
import { runQaBatch } from './qa-batch.js';
import { runReviewBatch } from './review-batch.js';

// ─── Module-level mocks ───────────────────────────────────────────────────────

const mockRun = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue('goose-hub-self/triager/0'),
}));

const mockAdviseOnPlan = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/advisor.js', () => ({
  adviseOnPlan: mockAdviseOnPlan,
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'test', payload: {}, createdAt: '' }),
  },
}));

vi.mock('@goose-hub/core/connectors/github/open-pr.js', () => ({
  openPR: vi.fn().mockResolvedValue({
    prNumber: 99,
    prUrl: 'https://github.com/test/pull/99',
    branch: 'factory/run-id',
    base: 'main',
  }),
}));

vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: vi.fn().mockReturnValue('/mock/worktree'),
  cleanupWorktree: vi.fn(),
  resolveWorktreeHeadSha: vi.fn().mockReturnValue('mock-sha-abc123'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

const mockGetSourceForSlug = vi.fn();
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

// ─── Factories ────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Test work item',
    body: 'Integration test fixture.',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockSource(): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
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

function makeAgentResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

function makeTriageOutput(type: 'feature' | 'bug' | 'research' = 'feature') {
  return {
    type,
    priority: 'p2',
    labels: [],
    reasoning: `Integration test: ${type}`,
    decisionSummaries: [{ step: 'type-classification', summary: `Classified as ${type}` }],
  };
}

function makeRepoMatchOutput() {
  return {
    candidates: [{ repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1 }],
    decisionSummaries: [],
  };
}

function makeImplementOutput() {
  return {
    plan: 'Integration test plan',
    filesWritten: [{ path: 'test.ts', reason: 'integration fixture' }],
    testsWritten: [],
    prUrl: 'https://github.com/test/pull/99',
    evidenceSpecPath: null,
    confidence: 'high',
    decisionSummaries: [{ step: 'implement', summary: 'Mock implementation' }],
  };
}

function makeInvestigateOutput() {
  return {
    findings: 'Integration test findings',
    keyFiles: [],
    confidence: 'high',
    openQuestions: [],
    decisionSummaries: [{ step: 'investigate', summary: 'Mock investigation' }],
  };
}

// NOTE: verify exact field names against slices/qa/schema.ts before using
function makeQaOutput() {
  return {
    verdict: 'pass',
    tier: 'functional',
    criteriaResults: [],
    decisionSummaries: [{ step: 'qa', summary: 'Mock QA pass' }],
  };
}

// NOTE: verify exact field names against slices/review/schema.ts before using
function makeReviewOutput() {
  return {
    verdict: 'approved',
    feedback: null,
    decisionSummaries: [{ step: 'review', summary: 'Mock review approval' }],
  };
}

function makeAdvisorOutput(verdict: 'proceed' | 'revise' | 'abort') {
  return {
    verdict,
    feedback: verdict !== 'proceed' ? 'Advisor feedback for integration test' : null,
    decisionSummaries: [{ step: 'advise', summary: `Advisor verdict: ${verdict}` }],
  };
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

const WEBHOOK_SECRET = 'test-integration-secret';

async function postWebhook(
  body: string,
  { event = 'issues' }: { event?: string } = {},
) {
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const { app } = await import('../../server.js');
  return app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': sign(body, WEBHOOK_SECRET),
      'X-GitHub-Event': event,
    },
    body,
  });
}

function makeWebhookPayload(labelName: string, issueNumber = 42) {
  return {
    action: 'labeled',
    label: { name: labelName },
    issue: {
      number: issueNumber,
      title: 'Test work item',
      body: 'Integration test fixture.',
      labels: [
        { name: labelName },
        { name: 'type:feature' },
        { name: 'priority:medium' },
        { name: 'schedule:current' },
        { name: 'mode:supervised' },
        { name: 'exec:serial' },
      ],
    },
    repository: { full_name: 'shaunnez/goose-hub' },
    installation: null,
  };
}

// ─── Layer A: Triage scenarios ────────────────────────────────────────────────

describe('Layer A: Triage state paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes feature to factory:dev-ready via factory:accepted', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    source.listOpenWork.mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('feature')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:triaging', 'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:accepted', 'factory:dev-ready',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('routes bug to factory:investigating via factory:accepted', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'bug' });
    const source = makeMockSource();
    source.listOpenWork.mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('bug')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:triaging', 'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:accepted', 'factory:investigating',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('routes research to factory:research-pending via factory:accepted', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    source.listOpenWork.mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('research')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:triaging', 'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:accepted', 'factory:research-pending',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run the triage tests**

```
pnpm --filter @goose-hub/server test -- state-flows
```

Expected: 3 tests pass. If any fail, read the error carefully — likely a wrong state name or type mismatch in the triage output.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/workflows/state-flows.test.ts
git commit -m "test(state-flows): Layer A triage scenarios (3/14)"
```

---

## Task 5: Write Layer A fix-issue tests (5 scenarios)

**Files:**
- Modify: `apps/server/src/domains/workflows/state-flows.test.ts`

Before writing, read `slices/fix-issue/workflow.ts` lines 80–210 to confirm:
1. The exact `transitionState` call for `factory:dev-ready → factory:in-progress` (line ~85)
2. The abort path: `factory:in-progress → factory:needs-human` (line ~129)
3. The success path: `factory:in-progress → factory:needs-qa` (line ~367)
4. The failure/catch path: `factory:in-progress → factory:needs-human` (line ~200)

- [ ] **Step 1: Import fix-issue, QA, and review workflow functions**

Add these imports at the top of `state-flows.test.ts` (after the batch function imports):
```typescript
import { runFixIssueWorkflow } from '../../../../slices/fix-issue/workflow.js';
import { runQaWorkflow } from '../../../../slices/qa/workflow.js';
import { runReviewWorkflow } from '../../../../slices/review/workflow.js';
```

> **Verify:** Check the workspace package layout — slices may be under a different path prefix. Run:
> ```
> grep -r "runFixIssueWorkflow" apps/server/src/shared/dispatch.ts
> ```
> This will show the exact dynamic import path used in production. Use the same relative path from `apps/server/src/domains/workflows/`.

- [ ] **Step 2: Add the fix-issue describe block**

Append to `state-flows.test.ts`:

```typescript
// ─── Layer A: Fix-issue scenarios ─────────────────────────────────────────────

describe('Layer A: Fix-issue state paths', () => {
  const SLUG = 'goose-hub-self';
  const REPO_ROOT = '/mock/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path (medium priority): dev-ready → approved', async () => {
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });
    const qaItem = makeWorkItem({ state: 'factory:needs-qa', priority: 'medium' });
    const reviewItem = makeWorkItem({ state: 'factory:needs-review', priority: 'medium' });
    const source = makeMockSource();

    // fix-issue takes item directly — configure listOpenWork for downstream batches
    source.listOpenWork
      .mockResolvedValueOnce([qaItem])     // qa-batch finds this item
      .mockResolvedValueOnce([reviewItem]); // review-batch finds this item

    // implement → qa → review
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeImplementOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeQaOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeReviewOutput()));

    await runFixIssueWorkflow(devReadyItem, source, SLUG, REPO_ROOT);
    await runQaBatch(SLUG, source);
    await runReviewBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3, '42', 'factory:needs-qa', 'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4, '42', 'factory:needs-review', 'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
  });

  it('failure (implement invalid output): dev-ready → needs-human', async () => {
    const item = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });
    const source = makeMockSource();

    // Simulate implement returning invalid/unparseable output
    mockRun.mockResolvedValueOnce(makeAgentResult({ invalid: 'garbage output' }));

    await runFixIssueWorkflow(item, source, SLUG, REPO_ROOT);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
    expect(source.comment).toHaveBeenCalled(); // failure comment is posted
  });

  it('advisor proceed (high priority): dev-ready → approved', async () => {
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });
    const qaItem = makeWorkItem({ state: 'factory:needs-qa', priority: 'high' });
    const reviewItem = makeWorkItem({ state: 'factory:needs-review', priority: 'high' });
    const source = makeMockSource();

    source.listOpenWork
      .mockResolvedValueOnce([qaItem])
      .mockResolvedValueOnce([reviewItem]);

    // First run() for plan (advisor path), advisor proceeds, no second implement call
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeImplementOutput())) // plan run
      .mockResolvedValueOnce(makeAgentResult(makeQaOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeReviewOutput()));

    mockAdviseOnPlan.mockResolvedValueOnce(makeAdvisorOutput('proceed'));

    await runFixIssueWorkflow(devReadyItem, source, SLUG, REPO_ROOT);
    await runQaBatch(SLUG, source);
    await runReviewBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3, '42', 'factory:needs-qa', 'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4, '42', 'factory:needs-review', 'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
    expect(mockAdviseOnPlan).toHaveBeenCalledTimes(1);
    // Only one implement run (proceed uses the plan run output)
    expect(mockRun).toHaveBeenCalledTimes(3); // plan + qa + review
  });

  it('advisor revise (high priority): dev-ready → approved', async () => {
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });
    const qaItem = makeWorkItem({ state: 'factory:needs-qa', priority: 'high' });
    const reviewItem = makeWorkItem({ state: 'factory:needs-review', priority: 'high' });
    const source = makeMockSource();

    source.listOpenWork
      .mockResolvedValueOnce([qaItem])
      .mockResolvedValueOnce([reviewItem]);

    // Plan run → advisor revise → revision run → qa → review
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeImplementOutput())) // plan run
      .mockResolvedValueOnce(makeAgentResult(makeImplementOutput())) // revision run
      .mockResolvedValueOnce(makeAgentResult(makeQaOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeReviewOutput()));

    mockAdviseOnPlan.mockResolvedValueOnce(makeAdvisorOutput('revise'));

    await runFixIssueWorkflow(devReadyItem, source, SLUG, REPO_ROOT);
    await runQaBatch(SLUG, source);
    await runReviewBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3, '42', 'factory:needs-qa', 'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4, '42', 'factory:needs-review', 'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
    // Two implement runs + qa + review
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it('advisor abort (high priority): dev-ready → needs-human', async () => {
    const item = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });
    const source = makeMockSource();

    mockRun.mockResolvedValueOnce(makeAgentResult(makeImplementOutput())); // plan run only

    mockAdviseOnPlan.mockResolvedValueOnce(makeAdvisorOutput('abort'));

    await runFixIssueWorkflow(item, source, SLUG, REPO_ROOT);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
    expect(source.comment).toHaveBeenCalled(); // abort comment is posted
    expect(mockAdviseOnPlan).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(1); // only the plan run
  });
});
```

> **Note on `runQaBatch` + `runReviewBatch` in tests:** These batch functions call `source.listOpenWork()` and then filter by state. The mock items returned must have the correct `state` value that the batch functions filter on — confirm the exact filter logic in `qa-batch.ts` and `review-batch.ts`.

- [ ] **Step 3: Run the fix-issue tests**

```
pnpm --filter @goose-hub/server test -- state-flows
```

Expected: 8 tests pass (3 triage + 5 fix-issue). Fix any failures by:
1. Checking the exact state names in the error ("factory:in-progress" vs "factory:dev-ready" typos)
2. Checking if `makeQaOutput()` / `makeReviewOutput()` field names match the actual skill schemas
3. Checking if fix-issue calls `adviseOnPlan` when priority is 'high' vs 'critical' — verify the gate condition in `workflow.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/domains/workflows/state-flows.test.ts
git commit -m "test(state-flows): Layer A fix-issue scenarios (8/14)"
```

---

## Task 6: Write Layer A investigate tests (2 scenarios)

**Files:**
- Modify: `apps/server/src/domains/workflows/state-flows.test.ts`

- [ ] **Step 1: Verify investigate workflow transitions**

Read `slices/investigate/workflow.ts` and confirm:
- Success path: `factory:investigating → factory:investigation-complete`
- Failure/catch path: `factory:investigating → factory:needs-human`

Note the function signature: `runInvestigateWorkflow(workItem, stateSource, projectId, targetRepo)`.

- [ ] **Step 2: Add the investigate describe block**

Append to `state-flows.test.ts`:

```typescript
// ─── Layer A: Investigate scenarios ──────────────────────────────────────────

describe('Layer A: Investigate state paths', () => {
  const SLUG = 'goose-hub-self';
  const REPO_ROOT = '/mock/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: investigating → investigation-complete', async () => {
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();

    mockRun.mockResolvedValueOnce(makeAgentResult(makeInvestigateOutput()));

    await runInvestigateWorkflow(item, source, SLUG, REPO_ROOT);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:investigating', 'factory:investigation-complete',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(1);
  });

  it('failure (invalid output): investigating → needs-human', async () => {
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();

    // Return invalid output that fails schema validation
    mockRun.mockResolvedValueOnce(makeAgentResult({ invalid: 'garbage' }));

    await runInvestigateWorkflow(item, source, SLUG, REPO_ROOT);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:investigating', 'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(1);
    expect(source.comment).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run all Layer A tests**

```
pnpm --filter @goose-hub/server test -- state-flows
```

Expected: 10 tests pass (3 triage + 5 fix-issue + 2 investigate).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/domains/workflows/state-flows.test.ts
git commit -m "test(state-flows): Layer A investigate scenarios (10/14)"
```

---

## Task 7: Write Layer B dispatch-chain tests (4 scenarios)

**Files:**
- Modify: `apps/server/src/domains/workflows/state-flows.test.ts`

Layer B tests fire the real Hono webhook handler and verify the full dispatch chain. The handler is fire-and-forget so `vi.waitFor` is required to wait for async completion.

- [ ] **Step 1: Verify the webhook route path**

Run:
```
grep -rn "webhooks/github\|/webhook" apps/server/src/ --include="*.ts" | grep -v test
```

Confirm the endpoint is `/webhooks/github` (used in `postWebhook`). If different, update the helper.

- [ ] **Step 2: Verify `getSourceForSlug` import path in dispatch.ts**

Run:
```
grep "getSourceForSlug" apps/server/src/shared/dispatch.ts
```

The vi.mock path in the test (`'../../shared/source.js'`) must resolve to the same module that dispatch.ts imports `getSourceForSlug` from. If dispatch.ts uses `'./source.js'`, both paths resolve to `apps/server/src/shared/source.js` — this is correct.

- [ ] **Step 3: Append the Layer B describe block**

Append to `state-flows.test.ts`:

```typescript
// ─── Layer B: Dispatch chain tests ────────────────────────────────────────────

describe('Layer B: Full dispatch chain (webhook → workflow → state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triaging dispatch: webhook → triage batch → factory:dev-ready', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    source.listOpenWork.mockResolvedValue([item]);
    mockGetSourceForSlug.mockResolvedValue(source);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('feature')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    const body = JSON.stringify(makeWebhookPayload('factory:triaging'));
    const res = await postWebhook(body);
    expect(res.status).toBe(202);

    await vi.waitFor(
      () => {
        expect(source.transitionState).toHaveBeenCalledWith(
          '42', 'factory:accepted', 'factory:dev-ready',
        );
      },
      { timeout: 5000 },
    );

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:triaging', 'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('dev-ready dispatch: webhook → fix-issue → factory:needs-qa', async () => {
    const item = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium', type: 'feature' });
    const source = makeMockSource();
    source.getItem.mockResolvedValue(item);
    mockGetSourceForSlug.mockResolvedValue(source);

    mockRun.mockResolvedValueOnce(makeAgentResult(makeImplementOutput()));

    const body = JSON.stringify(makeWebhookPayload('factory:dev-ready'));
    const res = await postWebhook(body);
    expect(res.status).toBe(202);

    await vi.waitFor(
      () => {
        expect(source.transitionState).toHaveBeenCalledWith(
          '42', 'factory:in-progress', 'factory:needs-qa',
        );
      },
      { timeout: 5000 },
    );

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:dev-ready', 'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('investigating dispatch: webhook → investigate → factory:investigation-complete', async () => {
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();
    source.getItem.mockResolvedValue(item);
    mockGetSourceForSlug.mockResolvedValue(source);

    mockRun.mockResolvedValueOnce(makeAgentResult(makeInvestigateOutput()));

    const body = JSON.stringify(makeWebhookPayload('factory:investigating'));
    const res = await postWebhook(body);
    expect(res.status).toBe(202);

    await vi.waitFor(
      () => {
        expect(source.transitionState).toHaveBeenCalledWith(
          '42', 'factory:investigating', 'factory:investigation-complete',
        );
      },
      { timeout: 5000 },
    );

    expect(source.transitionState).toHaveBeenCalledTimes(1);
  });

  it('full chore pipeline: triaging webhook → dev-ready webhook → factory:approved', async () => {
    const source = makeMockSource();
    const trigItem = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium', type: 'feature' });
    const qaItem = makeWorkItem({ state: 'factory:needs-qa', priority: 'medium' });
    const reviewItem = makeWorkItem({ state: 'factory:needs-review', priority: 'medium' });

    mockGetSourceForSlug.mockResolvedValue(source);

    // ── Phase 1: triage ──
    source.listOpenWork.mockResolvedValueOnce([trigItem]);
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('feature')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    const triageBody = JSON.stringify(makeWebhookPayload('factory:triaging'));
    await postWebhook(triageBody);

    await vi.waitFor(
      () => {
        expect(source.transitionState).toHaveBeenCalledWith(
          '42', 'factory:accepted', 'factory:dev-ready',
        );
      },
      { timeout: 5000 },
    );

    // ── Phase 2: fix-issue ──
    source.getItem.mockResolvedValue(devReadyItem);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeImplementOutput()));

    const devReadyBody = JSON.stringify(makeWebhookPayload('factory:dev-ready'));
    await postWebhook(devReadyBody);

    await vi.waitFor(
      () => {
        expect(source.transitionState).toHaveBeenCalledWith(
          '42', 'factory:in-progress', 'factory:needs-qa',
        );
      },
      { timeout: 5000 },
    );

    // ── Phase 3: QA + review (direct batch calls, not via webhook) ──
    source.listOpenWork
      .mockResolvedValueOnce([qaItem])
      .mockResolvedValueOnce([reviewItem]);
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeQaOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeReviewOutput()));

    await runQaBatch('goose-hub-self', source);
    await runReviewBatch('goose-hub-self', source);

    // Full transition chain assertion
    const calls = (source.transitionState as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual(['42', 'factory:triaging', 'factory:accepted']);
    expect(calls[1]).toEqual(['42', 'factory:accepted', 'factory:dev-ready']);
    expect(calls[2]).toEqual(['42', 'factory:dev-ready', 'factory:in-progress']);
    expect(calls[3]).toEqual(['42', 'factory:in-progress', 'factory:needs-qa']);
    expect(calls[4]).toEqual(['42', 'factory:needs-qa', 'factory:needs-review']);
    expect(calls[5]).toEqual(['42', 'factory:needs-review', 'factory:approved']);
    expect(source.transitionState).toHaveBeenCalledTimes(6);
  });
});
```

> **Note on `dispatchInvestigate` / `dispatchFixIssue` source lookup:** These functions call `source.getItem(issueNumber.toString())`. The mock `source.getItem` must return the right work item. The `mockGetSourceForSlug` mock returns the `source` object for any slug.

- [ ] **Step 4: Run all integration tests**

```
pnpm --filter @goose-hub/server test -- state-flows
```

Expected: 14 tests pass. Common Layer B failures:
- `vi.waitFor` timeout: the dispatch chain may be erroring silently. Add `console.log` temporarily inside `mockRun` to confirm it's being called.
- Wrong `source.getItem` mock: dispatch functions call `source.getItem(issueNumber.toString())` — confirm the mock returns the item for the right issue number.
- Module import cache: if `app` is cached between tests, vi.mock changes may not take effect. Wrap the server import in `vi.isolateModules` if needed.

- [ ] **Step 5: Run the full server test suite to verify no regressions**

```
pnpm --filter @goose-hub/server test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/workflows/state-flows.test.ts
git commit -m "test(state-flows): Layer B dispatch-chain scenarios (14/14)"
```

---

## Task 8: Create Playwright pipeline config

**Files:**
- Create: `apps/web/playwright-e2e-pipeline.config.ts`

- [ ] **Step 1: Read the existing Playwright config**

Read `apps/web/playwright.config.ts` to get the exact structure (webServer commands, port values, timeout settings).

- [ ] **Step 2: Create the pipeline config**

```typescript
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '../../.env') });

const PORT = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e/pipeline',
  timeout: 60_000,  // longer — mock agents still need SSE propagation
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer:
    process.env.SKIP_WEBSERVER === '1'
      ? undefined
      : [
          {
            command: 'pnpm --filter @goose-hub/server start',
            port: 3001,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
              MOCK_AGENTS: 'true',
              MOCK_OPEN_PR: 'true',
            },
          },
          {
            command: `pnpm dev --port ${PORT}`,
            port: PORT,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
          },
        ],
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright-e2e-pipeline.config.ts
git commit -m "test(e2e): add playwright-e2e-pipeline config with MOCK_AGENTS=true"
```

---

## Task 9: Write Playwright e2e pipeline test

**Files:**
- Create: `apps/web/e2e/pipeline/state-flow.spec.ts`

Before writing, read `apps/web/e2e/happy-path.spec.ts` in full to understand:
- The `gh()` API helper used for GitHub API calls
- The `SERVER_URL`, `PROJECT_SLUG`, `REPO` constants
- The existing `beforeAll` / `afterAll` fixture patterns

- [ ] **Step 1: Verify UI data-testid selectors exist**

Run:
```
grep -rn "data-testid\|data-event-kind" apps/web/src/ --include="*.tsx" | grep -E "state-badge|timeline|inbox|capture|promote"
```

Note which selectors are present. If `state-badge` is missing from the issue detail view, or if `[data-event-kind]` is not on timeline events, you will need to add them in the relevant UI components before the test can work. Do NOT add placeholder tests — fix the UI first or note the gap.

- [ ] **Step 2: Create the pipeline directory**

```bash
mkdir -p apps/web/e2e/pipeline
```

- [ ] **Step 3: Create the test file**

Create `apps/web/e2e/pipeline/state-flow.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'shaunnez/goose-hub';
const PROJECT_SLUG = 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const MILESTONE_TITLE = '[E2E Pipeline] Tests';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gh(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}`);
  return res.json();
}

async function triggerTick(slug: string) {
  const res = await fetch(`${SERVER_URL}/projects/${slug}/tick`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /projects/${slug}/tick → ${res.status}`);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('Pipeline e2e (MOCK_AGENTS=true)', () => {
  test.skip(!TOKEN, 'GITHUB_TOKEN required for e2e pipeline tests');

  let milestoneNumber: number;
  let chorIssueNumber: number;
  let bugIssueNumber: number;

  test.beforeAll(async () => {
    // Find or create E2E Pipeline milestone
    const milestones = (await gh(
      `/repos/${REPO}/milestones?state=all&per_page=100`,
    )) as Array<{ number: number; title: string; state: string }>;

    const existing = milestones.find((m) => m.title === MILESTONE_TITLE);
    if (existing) {
      if (existing.state === 'closed') {
        await gh(`/repos/${REPO}/milestones/${existing.number}`, 'PATCH', { state: 'open' });
      }
      milestoneNumber = existing.number;
    } else {
      const created = (await gh(`/repos/${REPO}/milestones`, 'POST', {
        title: MILESTONE_TITLE,
      })) as { number: number };
      milestoneNumber = created.number;
    }

    // Set active milestone on the server
    await fetch(`${SERVER_URL}/projects/${PROJECT_SLUG}/active-milestone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneNumber }),
    });
  });

  test.afterAll(async () => {
    if (chorIssueNumber) {
      await gh(`/repos/${REPO}/issues/${chorIssueNumber}`, 'PATCH', { state: 'closed' });
    }
    if (bugIssueNumber) {
      await gh(`/repos/${REPO}/issues/${bugIssueNumber}`, 'PATCH', { state: 'closed' });
    }
  });

  // ── Scenario 1: Chore pipeline ──────────────────────────────────────────────

  test('chore pipeline: inbox capture → factory:approved', async ({ page }) => {
    const timestamp = Date.now();
    const choreTitle = `[E2E Pipeline] Chore ${timestamp}`;

    // 1. Navigate to inbox
    await page.goto(`/projects/${PROJECT_SLUG}/inbox`);
    await expect(page).toHaveURL(/inbox/);

    // 2. Capture a new inbox item
    const captureBtn = page.getByTestId('capture-button');
    await expect(captureBtn).toBeVisible({ timeout: 10_000 });
    await captureBtn.click();

    const titleInput = page.getByTestId('capture-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(choreTitle);

    await page.getByTestId('capture-submit').click();

    // 3. Inbox shows the new item
    await expect.poll(
      () => page.getByTestId('inbox-item').filter({ hasText: choreTitle }).count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    // 4. Promote the item
    const inboxItem = page.getByTestId('inbox-item').filter({ hasText: choreTitle }).first();
    await inboxItem.getByTestId('promote-button').click();

    const projectSelect = page.getByTestId('promote-project-select');
    await expect(projectSelect).toBeVisible();
    await projectSelect.selectOption(PROJECT_SLUG);

    await page.getByTestId('promote-next').click();
    await page.getByTestId('promote-confirm').click();

    // 5. Navigate to board, select milestone
    await page.goto(`/projects/${PROJECT_SLUG}`);
    const milestoneSelector = page.locator('select[data-testid="milestone-selector"]');
    await expect(milestoneSelector).toBeVisible({ timeout: 15_000 });
    await milestoneSelector.selectOption({ value: String(milestoneNumber) });

    // 6. Issue card appears in triaging column
    const cards = page.getByTestId('issue-card');
    await expect.poll(
      () => cards.filter({ hasText: choreTitle }).count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    const card = cards.filter({ hasText: choreTitle }).first();
    chorIssueNumber = Number(await card.getAttribute('data-issue-number'));

    // 7. Click card → navigate to detail → Timeline tab
    await card.click();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });

    // 8. Trigger triage batch via server tick
    await triggerTick(PROJECT_SLUG);

    // 9. Wait for triage agent events in timeline
    await expect(
      page.locator('[data-event-kind="agent.run-started"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    await expect(
      page.locator('[data-event-kind="agent.triage-complete"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // 10. State transitions to factory:dev-ready (webhook auto-triggers fix-issue)
    await expect(page.getByTestId('state-badge')).toHaveText('factory:dev-ready', { timeout: 30_000 });

    // 11. Wait for fix-issue to run (triggered by dev-ready webhook)
    await expect(
      page.locator('[data-event-kind="agent.implement-complete"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // 12. Wait for PR open event
    await expect(
      page.locator('[data-event-kind="pr.opened"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // 13. Wait for final approved state (QA + review triggered via webhooks)
    await expect(page.getByTestId('state-badge')).toHaveText('factory:approved', { timeout: 60_000 });
  });

  // ── Scenario 2: Bug pipeline ────────────────────────────────────────────────

  test('bug pipeline: triaging → factory:investigation-complete', async ({ page }) => {
    // Create GitHub issue directly (already in triaging state)
    const issue = (await gh(`/repos/${REPO}/issues`, 'POST', {
      title: `[E2E Pipeline] Bug ${Date.now()}`,
      body: 'Automated e2e fixture — safe to close.',
      milestone: milestoneNumber,
      labels: [
        'factory:triaging',
        'priority:medium',
        'type:bug',
        'schedule:current',
        'mode:supervised',
        'exec:serial',
      ],
    })) as { number: number };
    bugIssueNumber = issue.number;

    // Navigate to board
    await page.goto(`/projects/${PROJECT_SLUG}`);
    const milestoneSelector = page.locator('select[data-testid="milestone-selector"]');
    await expect(milestoneSelector).toBeVisible({ timeout: 15_000 });
    await milestoneSelector.selectOption({ value: String(milestoneNumber) });

    // Issue card appears in triaging column
    const cards = page.getByTestId('issue-card');
    await expect.poll(
      () => cards.filter({ hasText: `#${bugIssueNumber}` }).count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    const card = cards.filter({ hasText: `#${bugIssueNumber}` }).first();
    await card.click();
    await page.getByRole('tab', { name: 'Timeline' }).click();

    // Trigger triage — mock returns type=bug
    await triggerTick(PROJECT_SLUG);

    // Wait for triage complete event
    await expect(
      page.locator('[data-event-kind="agent.triage-complete"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // State moves to factory:investigating (bug path)
    await expect(page.getByTestId('state-badge')).toHaveText('factory:investigating', { timeout: 30_000 });

    // Wait for investigate agent run (triggered by investigating webhook)
    await expect(
      page.locator('[data-event-kind="agent.investigation-complete"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // Final state: factory:investigation-complete
    await expect(page.getByTestId('state-badge')).toHaveText('factory:investigation-complete', { timeout: 30_000 });
  });
});
```

> **Key assumption:** The triage mock in `resolveMockOutput` always returns `type: 'chore'`. For the bug scenario, MOCK_AGENTS still returns chore type (as per the spec). The bug scenario test creates the issue with `type:bug` in the labels AND checks the `factory:triaging` → `factory:investigating` route. This will only work if the triage agent returns `type: 'bug'` for this test.
>
> **You may need to update `resolveMockOutput`** to check the work item's existing labels and return `type: 'bug'` when the item already has a `type:bug` label. OR add a second mock output preset that the server selects when the workitem is a bug. Read how the triage skill context is assembled to decide which approach fits better.
>
> Alternatively, the bug scenario could use a different approach: trigger the webhook directly via the test (POST to the server's webhook endpoint) with a `type:bug` triage output, bypassing MOCK_AGENTS. Decide which is cleaner after reading `resolveMockOutput` in context.

- [ ] **Step 4: Run the Playwright pipeline tests**

Start the server and frontend in a separate terminal first (or let Playwright do it):
```
pnpm playwright test --config apps/web/playwright-e2e-pipeline.config.ts
```

Expected: both tests pass. Common failures:
- `state-badge` testid missing: add `data-testid="state-badge"` to the state display component in the issue detail view
- `timeline-section` testid missing: add it to the Timeline tab content wrapper
- `[data-event-kind]` not on timeline events: add `data-event-kind={event.kind}` to the event list item component
- Triage mock returns `type: 'chore'` for bug scenario: see the note above

- [ ] **Step 5: Fix any missing data-testid attributes**

If UI selectors are missing, find the relevant components:
```
grep -rn "state-badge\|timeline-section\|event-kind" apps/web/src/ --include="*.tsx"
```

Add missing `data-testid` / `data-event-kind` attributes to the UI components that need them.

- [ ] **Step 6: Commit all changes**

```bash
git add apps/web/e2e/pipeline/ apps/web/playwright-e2e-pipeline.config.ts
git add apps/web/src/  # any UI testid additions
git commit -m "test(e2e): add pipeline state-flow spec (chore + bug scenarios)"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run all integration tests**

```
pnpm --filter @goose-hub/server test
```

Expected: all existing tests pass, plus 14 new state-flow tests.

- [ ] **Step 2: Run lint and type check**

```
pnpm biome check --write apps/server/src/domains/workflows/state-flows.test.ts
pnpm --filter @goose-hub/server tsc --noEmit
pnpm --filter @goose-hub/core tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Confirm Playwright command in project scripts**

Check `apps/web/package.json` for an existing `playwright` script. If there isn't one for the pipeline config, add:
```json
"test:e2e:pipeline": "playwright test --config playwright-e2e-pipeline.config.ts"
```

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete state-flow integration and e2e test suite"
```

---

## Acceptance Criteria Checklist

- [ ] `state-flows.test.ts` covers all 10 Layer A state-path scenarios
- [ ] `state-flows.test.ts` covers all 4 Layer B dispatch-chain scenarios
- [ ] Each test uses `toHaveBeenNthCalledWith` to assert exact `transitionState` order
- [ ] `MOCK_AGENTS=true` makes `ClaudeCliRuntime.run()` return preset outputs without spawning the CLI
- [ ] `MOCK_OPEN_PR=true` prevents real git push in dispatch layer
- [ ] Playwright scenario 1 completes from inbox capture → `factory:approved`
- [ ] Playwright scenario 2 completes from `factory:triaging` → `factory:investigation-complete`
- [ ] No real GitHub API calls in integration tests
- [ ] `pnpm test` still passes for all existing tests
- [ ] `pnpm playwright test --config apps/web/playwright-e2e-pipeline.config.ts` runs both scenarios
