# Fix-Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `factory:qa-failed` → `factory:needs-fix` → `factory:in-progress` → `factory:needs-qa` cycle so failed QA runs automatically re-dispatch to a fix agent that reuses the existing worktree and branch.

**Architecture:** New `slices/fix-feedback/` slice handles the fix agent run — it is NOT an extension of `fix-issue`. Key operational difference: fix-feedback finds the existing worktree from the `pr.opened` event, injects QA findings as `advisorFeedback`, runs implement in-place, then transitions back to `factory:needs-qa`. No new PR is opened. Dispatcher wiring adds `dispatchQaFailed` (auto-transition `qa-failed` → `needs-fix`) and `dispatchNeedsFix` (runs fix-feedback), both registered in `dispatchForLabel` and `RESUME_WORKFLOWS`.

**Tech Stack:** TypeScript, Zod, Vitest, Node child_process, `@goose-hub/core` event-stream/state-source/agent-runtime

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `slices/fix-feedback/slice.test.ts` | Create | Integration tests for `runFixFeedbackWorkflow` |
| `slices/fix-feedback/workflow.ts` | Create | Fix-feedback workflow — finds worktree, injects findings, re-runs implement |
| `slices/fix-feedback/README.md` | Create | Purpose, usage, context allowlist |
| `apps/server/src/shared/dispatch.ts` | Modify | Add `dispatchQaFailed`, `dispatchNeedsFix`, wire both into `dispatchForLabel` and `RESUME_WORKFLOWS` |

---

### Task 1: Write failing tests for `runFixFeedbackWorkflow`

**Files:**
- Create: `slices/fix-feedback/slice.test.ts`

- [ ] **Step 1: Create `slices/fix-feedback/slice.test.ts` with the scaffold and failing imports**

```typescript
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'proj/developer/0', codename: 'Grey Honker' }),
}));
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});

const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';

// Import after mocks
import { runFixFeedbackWorkflow } from './workflow.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Add capitalize helper',
    body: 'Add capitalize(s) to core/utils/strings.ts',
    type: 'chore',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:needs-fix',
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

function makeImplementOutput(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'Addressed QA findings.',
    filesWritten: [{ path: 'src/utils.ts', reason: 'Fixed null check' }],
    testsWritten: [{ path: 'src/utils.test.ts', cases: 1 }],
    testsRun: { command: 'pnpm test', paths: ['src/utils.test.ts'] },
    prUrl: 'https://github.com/owner/repo/pull/1',
    evidenceSpecPath: null,
    confidence: 'high',
    decisionSummaries: [{ kind: 'fix', summary: 'Fixed null check per QA finding' }],
    ...overrides,
  };
}

function makePrOpenedEvent(worktreePath = '/work/wt', branch = 'factory/run-abc') {
  return {
    id: 1,
    kind: 'pr.opened',
    payload: { prNumber: 99, prUrl: 'https://github.com/owner/repo/pull/99', branch, worktreePath, devRunId: 'run-abc' },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date(),
  };
}

function makeQaCompletedEvent(passed = false) {
  return {
    id: 2,
    kind: 'qa.completed',
    payload: {
      verdict: passed ? 'pass' : 'fail',
      overallScore: passed ? 85 : 45,
      threshold: 70,
      tierResults: {
        structural: {
          passed: true,
          findings: [],
        },
        functional: {
          passed: false,
          findings: [
            {
              tier: 'functional',
              severity: 'error',
              description: 'capitalize("") returns undefined instead of ""',
              suggestion: 'Handle empty string input',
              disposition: 'fix',
              dispositionRef: 'must fix',
            },
          ],
        },
        regression: { passed: true, findings: [] },
      },
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date(),
  };
}

describe('runFixFeedbackWorkflow', () => {
  let stateSource: StateSource;

  beforeEach(() => {
    stateSource = makeStateSource();
    vi.clearAllMocks();
    vi.mocked(eventStore.appendEvent).mockReturnValue({ id: 1 } as ReturnType<typeof eventStore.appendEvent>);
  });

  it('escalates to needs-human when no pr.opened event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([]);
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-human',
    );
    expect(stateSource.comment).toHaveBeenCalledWith('42', expect.stringContaining('no worktree'));
  });

  it('transitions needs-fix → in-progress → needs-qa on success', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenNthCalledWith(
      1, '42', 'factory:needs-fix', 'factory:in-progress',
    );
    expect(stateSource.transitionState).toHaveBeenNthCalledWith(
      2, '42', 'factory:in-progress', 'factory:needs-qa',
    );
  });

  it('passes QA findings as advisorFeedback to the implement skill', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.context.advisorFeedback).toContain('capitalize("") returns undefined');
  });

  it('passes existing worktreePath to the runtime', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent('/work/existing-wt')]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.context.worktreePath).toBe('/work/existing-wt');
  });

  it('escalates to needs-human when implement throws', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockRejectedValue(new Error('agent crashed'));
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(stateSource.comment).toHaveBeenCalledWith('42', expect.stringContaining('agent crashed'));
  });

  it('escalates to needs-human when implement output fails schema validation', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: { bad: 'output' } });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('emits agent.fix-feedback-complete event on success', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.fix-feedback-complete' }),
    );
  });

  it('works with custom runtime dep injection', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent()]);
    const customRun = vi.fn().mockResolvedValue({ output: makeImplementOutput() });
    const customRuntime: AgentRuntime = { run: customRun };
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo', {
      runtime: customRuntime,
    });

    expect(customRun).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail (module not found)**

```
pnpm --filter=@goose-hub/server test -- --reporter=json slices/fix-feedback/slice.test.ts
```

Expected: `Cannot find module './workflow.js'` — confirms the import will break until we create the file.

---

### Task 2: Implement `slices/fix-feedback/workflow.ts`

**Files:**
- Create: `slices/fix-feedback/workflow.ts`

- [ ] **Step 1: Create the workflow file**

```typescript
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';

export interface FixFeedbackDeps {
  runtime?: AgentRuntime;
}

/**
 * Finds the worktree path from the most recent `pr.opened` event for this work item.
 * Returns undefined if no such event exists.
 */
function findWorktreePath(workItemId: string): string | undefined {
  const events = eventStore.replay({ workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return undefined;
  const payload = prOpened.payload as Record<string, unknown>;
  return typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined;
}

/**
 * Extracts QA findings from the most recent `qa.completed` event and formats
 * them as a human-readable string for injection into the implement skill's
 * `advisorFeedback` field.
 *
 * Returns an empty string if no qa.completed event exists (implement still
 * runs; it just has no targeted feedback).
 */
function buildQaFeedback(workItemId: string): string {
  const events = eventStore.replay({ workItemId });
  const qaCompleted = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'qa.completed');
  if (qaCompleted == null) return '';

  type TierResult = {
    passed: boolean;
    findings: Array<{ tier: string; severity: string; description: string; suggestion?: string }>;
  };
  type QaPayload = {
    verdict?: string;
    overallScore?: number;
    threshold?: number;
    tierResults?: {
      structural?: TierResult;
      functional?: TierResult;
      regression?: TierResult;
    };
  };

  const payload = qaCompleted.payload as QaPayload;
  const { verdict = 'fail', overallScore = 0, threshold = 70, tierResults = {} } = payload;

  const lines: string[] = [
    `QA verdict: ${verdict} (score ${overallScore}/${threshold})`,
    '',
    'Findings to address:',
  ];

  for (const [tier, result] of Object.entries(tierResults) as [string, TierResult | undefined][]) {
    if (result == null || result.passed) continue;
    for (const f of result.findings) {
      lines.push(`- [${tier}/${f.severity}] ${f.description}${f.suggestion ? ` — ${f.suggestion}` : ''}`);
    }
  }

  return lines.join('\n');
}

/**
 * Runs the fix-feedback workflow for a work item in `factory:needs-fix` state.
 *
 * This workflow is invoked after QA fails and auto-transition has moved the
 * item from `factory:qa-failed` → `factory:needs-fix`. It differs from
 * fix-issue in that:
 * - It reuses the existing worktree (no new worktree created)
 * - It injects QA findings as `advisorFeedback` for the implement skill
 * - It pushes to the existing branch (no new PR opened)
 *
 * Sequence:
 *   1. Find existing worktree from `pr.opened` event → missing = needs-human
 *   2. Transition factory:needs-fix → factory:in-progress
 *   3. Run implement skill with QA findings as advisorFeedback, revisionPass=1
 *   4. Emit agent.fix-feedback-complete
 *   5. Transition factory:in-progress → factory:needs-qa
 *
 * On failure at any step: comment, transition to factory:needs-human.
 */
export async function runFixFeedbackWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  _targetRepo: string,
  deps: FixFeedbackDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();

  const worktreePath = findWorktreePath(workItem.id);
  if (worktreePath == null) {
    await stateSource.comment(
      workItem.externalId,
      'Fix-feedback: no worktree found — cannot locate existing dev workspace. Escalating.',
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-fix',
      'factory:needs-human',
    );
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: 'fix-feedback: no worktree found in pr.opened events' },
      runId,
    });
    return;
  }

  const implementPrompt = readPromptWithContext('implement', projectId);
  const implementJsonSchema = toJsonSchema(ImplementSchema);
  const { personaId } = selectPersona(projectId, 'developer');
  const advisorFeedback = buildQaFeedback(workItem.id);

  await stateSource.transitionState(workItem.externalId, 'factory:needs-fix', 'factory:in-progress');

  try {
    const result = await runtime.run({
      runId,
      role: 'developer',
      skill: 'implement',
      workspaceDir: worktreePath,
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
          priority: workItem.priority,
        },
        worktreePath,
        stack: {
          testCommand: 'pnpm test',
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
        },
        advisorFeedback: advisorFeedback || undefined,
        revisionPass: 1,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'workItem.priority',
        'worktreePath',
        'stack.testCommand',
        'stack.lintCommand',
        'stack.typecheckCommand',
        'advisorFeedback',
        'revisionPass',
      ],
      freshContext: false,
      toolBundles: ['dev-tools'],
      toolExtras: [],
      budgets: { maxTurns: 200, maxBudgetUsd: 2.0, timeoutMs: 600_000 },
      personaId,
      outputJsonSchema: implementJsonSchema,
      appendSystemPrompt: implementPrompt,
    });

    const parsed = ImplementSchema.safeParse(result.output);
    if (!parsed.success) {
      const rawPreview =
        typeof result.output === 'string'
          ? (result.output as string).slice(0, 400)
          : JSON.stringify(result.output).slice(0, 400);
      throw new Error(
        `fix-feedback implement output validation failed: ${JSON.stringify(parsed.error.issues)}\nRaw: ${rawPreview}`,
      );
    }

    const implementOutput = parsed.data;

    for (const summary of implementOutput.decisionSummaries) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.decision-summary',
        payload: { skill: 'fix-feedback', ...summary },
        runId,
      });
    }

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.fix-feedback-complete',
      payload: {
        filesWritten: implementOutput.filesWritten.length,
        testsWritten: implementOutput.testsWritten.length,
        confidence: implementOutput.confidence,
        testsRun: implementOutput.testsRun,
      },
      runId,
    });

    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'success' });

    await stateSource.comment(
      workItem.externalId,
      'Fix-feedback complete. Transitioning back to `factory:needs-qa`.',
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-qa',
    );
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });
    await stateSource.comment(workItem.externalId, `Fix-feedback failed: ${error.message}`);
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-human',
    );
  }
}
```

- [ ] **Step 2: Run the tests**

```
pnpm --filter=@goose-hub/server test -- --reporter=json slices/fix-feedback/slice.test.ts
```

Expected: `numFailedTests: 0`. If any fail, read `testResults[].assertionResults[]` where `status === "failed"` for the error detail.

- [ ] **Step 3: Run typecheck**

```
pnpm typecheck
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add slices/fix-feedback/workflow.ts slices/fix-feedback/slice.test.ts
git commit -m "feat(fix-feedback): runFixFeedbackWorkflow — reuses worktree, injects QA findings"
```

---

### Task 3: Add dispatcher wiring in `apps/server/src/shared/dispatch.ts`

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`

Two new functions: `dispatchQaFailed` (auto-transition `qa-failed` → `needs-fix`, then calls `dispatchNeedsFix` inline) and `dispatchNeedsFix` (runs fix-feedback workflow). Both added to `dispatchForLabel` and `RESUME_WORKFLOWS`.

- [ ] **Step 1: Add `dispatchNeedsFix` after `dispatchQa` (around line 220)**

Add this function immediately after the closing `}` of `dispatchQa`:

```typescript
/** Run the fix-feedback workflow for a single issue. Drops duplicate triggers. */
export async function dispatchNeedsFix(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchNeedsFix: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runFixFeedbackWorkflow } = (await import(
      new URL('../../../../slices/fix-feedback/workflow.js', import.meta.url).href
    )) as {
      runFixFeedbackWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        targetRepo: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchNeedsFix: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    await runFixFeedbackWorkflow(item, source, slug, item.repoRef ?? slug);
  } finally {
    _issueInFlight.delete(key);
  }
}
```

- [ ] **Step 2: Add `dispatchQaFailed` immediately after `dispatchNeedsFix`**

```typescript
/**
 * Auto-transition from qa-failed based on retry logic.
 * QA already applied shouldEscalateQa — if we reach this label, retries
 * remain. Transition qa-failed → needs-fix and dispatch fix-feedback.
 */
async function dispatchQaFailed(slug: string, issueNumber: number): Promise<void> {
  const key = issueKey(slug, issueNumber);
  if (_issueInFlight.has(key)) {
    logger.warn('dispatchQaFailed: already in-flight, dropping duplicate', { slug, issueNumber });
    return;
  }
  _issueInFlight.add(key);
  try {
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchQaFailed: no source for slug', { slug });
      return;
    }

    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:qa-failed') {
      logger.info('dispatchQaFailed: state already moved', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }

    const workItemId = `github:${source.repoRef}#${issueNumber}`;
    await source.transitionState(workItemId, 'factory:qa-failed', 'factory:needs-fix');

    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:qa-failed', to: 'factory:needs-fix', by: 'orchestrator' },
    });

    logger.info('dispatchQaFailed: transitioned to needs-fix, dispatching fix-feedback', {
      slug,
      issueNumber,
    });
  } finally {
    _issueInFlight.delete(key);
  }

  // Fire fix-feedback outside the in-flight guard so needs-fix can also
  // be triggered independently (e.g. review-failed path in the future).
  await dispatchNeedsFix(slug, issueNumber);
}
```

- [ ] **Step 3: Add both to `dispatchForLabel`**

In the `dispatchForLabel` function, after the `factory:retrospecting` block (before the final `logger.info` line), add:

```typescript
  if (labelName === 'factory:qa-failed') {
    await dispatchQaFailed(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:needs-fix') {
    await dispatchNeedsFix(slug, issueNumber);
    return;
  }
```

- [ ] **Step 4: Add both to `RESUME_WORKFLOWS`**

In the `RESUME_WORKFLOWS` object, after the `'factory:retrospecting'` entry, add:

```typescript
  'factory:qa-failed': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
  'factory:needs-fix': { targetState: 'factory:needs-fix', dispatch: dispatchNeedsFix },
```

Note: the `qa-failed` resume entry uses `targetState: 'factory:needs-fix'` so `dispatchResumeIssue` calls `forceState` to advance past `qa-failed` before running fix-feedback.

- [ ] **Step 5: Run typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Run lint on changed files**

```
pnpm biome check apps/server/src/shared/dispatch.ts
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/shared/dispatch.ts
git commit -m "feat(dispatch): wire factory:qa-failed and factory:needs-fix to fix-feedback workflow"
```

---

### Task 4: Create `slices/fix-feedback/README.md`

**Files:**
- Create: `slices/fix-feedback/README.md`

- [ ] **Step 1: Create README**

```markdown
# fix-feedback

Handles the QA retry loop: when QA fails and `factory:qa-failed` is applied, the orchestrator auto-transitions to `factory:needs-fix` and dispatches this workflow.

## What it does

1. Finds the existing dev worktree from the `pr.opened` event in the event store.
2. Extracts QA findings from the most recent `qa.completed` event.
3. Transitions `factory:needs-fix` → `factory:in-progress`.
4. Re-runs the `implement` skill in the existing worktree with QA findings injected as `advisorFeedback` and `revisionPass: 1`.
5. Pushes the fix to the existing branch (no new PR is opened).
6. Transitions `factory:in-progress` → `factory:needs-qa` to re-trigger QA.

## Key differences from fix-issue

| Concern | fix-issue | fix-feedback |
|---|---|---|
| Worktree | Creates new | Reuses existing (from `pr.opened` event) |
| Branch | Creates new `factory/<runId>` | Pushes to existing branch |
| PR | Opens new PR | No PR — existing PR updated |
| `revisionPass` | 0 | 1 (signals to implement skill this is a correction) |
| `advisorFeedback` | Optional advisor review | QA findings from `qa.completed` |

## Context allowlist

The implement skill receives:
- `workItem.title`, `workItem.body`, `workItem.number`, `workItem.priority`
- `worktreePath`
- `stack.testCommand`, `stack.lintCommand`, `stack.typecheckCommand`
- `advisorFeedback` — formatted QA findings
- `revisionPass` — always `1` for fix-feedback runs

## Escalation

Transitions to `factory:needs-human` if:
- No `pr.opened` event found (worktree cannot be located)
- Implement skill throws
- Implement schema validation fails
```

- [ ] **Step 2: Run full test suite to verify no regressions**

```
pnpm --filter=@goose-hub/server test -- --reporter=json
```

Expected: `numFailedTests: 0`.

- [ ] **Step 3: Run typecheck one final time**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add slices/fix-feedback/README.md
git commit -m "docs(fix-feedback): README — purpose, context allowlist, escalation paths"
```

---

## Self-Review

### Spec coverage check

| Requirement | Covered by |
|---|---|
| `factory:qa-failed` dispatches to fix workflow | Task 3 — `dispatchQaFailed` in `dispatchForLabel` |
| Auto-transition `qa-failed` → `needs-fix` | Task 3 — `dispatchQaFailed` calls `source.transitionState` |
| `factory:needs-fix` dispatches fix-feedback | Task 3 — `dispatchNeedsFix` in `dispatchForLabel` |
| Reuse existing worktree | Task 2 — `findWorktreePath` from `pr.opened` |
| QA findings injected as feedback | Task 2 — `buildQaFeedback` from `qa.completed` |
| No new PR opened | Task 2 — no `openPR` call |
| Push to existing branch | Task 2 — implement skill handles git push in worktree |
| `factory:in-progress` → `factory:needs-qa` | Task 2 — `transitionState` at end of workflow |
| `RESUME_WORKFLOWS` entries | Task 3 — both `qa-failed` and `needs-fix` entries |
| Escalate to `needs-human` on missing worktree | Task 2 — explicit guard |
| Escalate to `needs-human` on implement failure | Task 2 — catch block |
| Tests | Task 1 — 7 integration tests |

### Placeholder scan

No placeholders. All code blocks are complete and self-contained.

### Type consistency check

- `runFixFeedbackWorkflow` signature matches the dynamic import cast in `dispatchNeedsFix`
- `ImplementSchema.safeParse` produces the same `ImplementOutput` type used throughout fix-issue
- `eventStore.appendEvent` calls match the pattern in fix-issue and qa workflows
- `RESUME_WORKFLOWS` entry type: `{ targetState: StateName, dispatch: (slug, issueNumber) => Promise<void> }` — matches `ResumeEntry` typedef in dispatch.ts
