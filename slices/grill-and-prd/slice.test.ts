/**
 * M13.05 — grill-and-prd workflow slice tests.
 *
 * Each test calls `runGrillAndPrdWorkflow` once (one tick) with a mocked
 * `AgentRuntime` whose `run()` is queued to return per-skill outputs in
 * call order. The workflow always invokes grill-me first, so the first
 * queued response is the grill-me output; subsequent responses are write-prd
 * and (when eligible) advise-on-prd.
 *
 * State machine: the in-memory source enforces legal transitions, so issues
 * are seeded directly in the lane state the workflow expects (factory:grilling
 * for round 1, factory:gate-pending for round 2 onwards).
 */
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import type { Priority } from '@goose-hub/core/state-source/interface.js';
import { runGrillAndPrdWorkflow } from '@goose-hub/core/workflows/grill-and-prd.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_REF = 'test-owner/test-repo';

/** Unique projectId per test to prevent event-stream leakage between tests. */
function uniqueProjectId(label: string): string {
  return `test-grill-and-prd-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns an `AgentRuntime` whose `run()` returns the queued outputs in order.
 * `outputs` may include either a raw output value or a full AgentResult.
 */
function makeQueuedRuntime(outputs: unknown[]): AgentRuntime {
  let i = 0;
  return {
    run: vi.fn().mockImplementation(async () => {
      const o = outputs[i];
      i += 1;
      if (o == null) {
        throw new Error(`makeQueuedRuntime: out of queued outputs at call ${i}`);
      }
      return {
        output: o,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult;
    }),
  };
}

function validGrillRound1NotReady() {
  return {
    questions: ['What does "better" mean — faster, fewer errors, or higher conversion?'],
    refinedIntent: 'Improve some aspect of the onboarding flow.',
    readyForPRD: false,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Asked about success metric to anchor scope.',
        evidence: 'work item body uses the word "better" without qualification',
      },
    ],
  };
}

function validGrillReady() {
  return {
    questions: [],
    refinedIntent:
      'Reduce drop-off at the profile step of onboarding by surfacing inline validation errors.',
    readyForPRD: true,
    decisionSummaries: [
      {
        kind: 'VERDICT',
        summary: 'Intent is precise enough to write a PRD.',
        evidence: 'User confirmed metric, audience, and success condition in prior replies',
      },
    ],
  };
}

function validPRD(overrides: Partial<ReturnType<typeof basePRD>> = {}) {
  return { ...basePRD(), ...overrides };
}

function basePRD() {
  return {
    title: 'Inline validation in onboarding',
    problem: 'Users drop off at the profile step because errors only surface on submit.',
    proposedSolution:
      'Add field-level validation on blur with inline error messages and analytics events.',
    outOfScope: ['Refactoring the onboarding wizard navigation'],
    successCriteria: ['Drop-off at profile step decreases by ≥ 20% within 30 days'],
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'Each profile field validates on blur and renders an inline error.',
        journeyId: 'J-1',
        stepIdx: 1,
      },
      {
        id: 'AC-2',
        statement: 'All validation events are logged to analytics.',
        crossCutting: true,
      },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'New user',
        trigger: 'Reaches the profile step',
        steps: [
          {
            userAction: 'Types name',
            systemResponse: 'Renders field as valid',
            dataShown: 'Green check',
            stateChange: 'Field marked valid',
          },
          {
            userAction: 'Tabs out of email field with invalid value',
            systemResponse: 'Renders inline error below field',
            dataShown: 'Error message',
            stateChange: 'Field marked invalid',
          },
        ],
        successState: 'All fields valid → Submit enabled',
        errorStates: [
          {
            error: 'Network drops while validating async fields',
            recovery: 'Show retry banner; submit disabled until retry succeeds',
          },
        ],
        edgeCases: ['Pasted multiline values'],
      },
    ],
    functionalSpec: {
      behaviors: [
        {
          when: 'A profile field loses focus with an invalid value',
          given: 'The user has typed at least one character',
          // biome-ignore lint/suspicious/noThenProperty: PRD FunctionalSpec.behaviors[*].then is the BDD "Then" clause, not Promise#then.
          then: 'The system renders an inline error message below the field',
        },
      ],
      stateModel: [
        {
          state: 'pristine',
          entryCondition: 'Form mounted, no fields touched',
          behaviorsAvailable: ['edit'],
          exitTransitions: ['touched'],
        },
        {
          state: 'touched',
          entryCondition: 'Any field has lost focus at least once',
          behaviorsAvailable: ['edit', 'submit'],
          exitTransitions: ['valid', 'invalid'],
        },
      ],
      invalidTransitions: [
        {
          from: 'pristine',
          to: 'submitted',
          reason: 'User must touch at least one field before the form can submit',
        },
      ],
      dataConstraints: [{ type: 'email', validation: 'RFC 5322 compliant' }],
    },
    verticalSlices: [
      {
        title: 'Slice 1: inline validation',
        goal: 'Add on-blur validation with inline messaging',
        estimatedSize: 'M' as const,
        journeyRefs: ['J-1'],
      },
    ],
    estimatedComplexity: 'medium' as const,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Single slice covers the journey end-to-end.',
      },
    ],
  };
}

function validAdvisorRevise() {
  return {
    verdict: 'revise' as const,
    concerns: [
      'The problem statement should quantify the current drop-off rate to anchor the success metric.',
    ],
    revisedSections: {
      problem:
        'Current onboarding drop-off at the profile step is 38% (Q1 telemetry); deferred validation surfaces errors only on submit, masking the failure point.',
    },
    decisionSummaries: [
      {
        kind: 'VERDICT',
        summary: 'PRD revised: problem statement needed quantified drop-off rate.',
      },
    ],
  };
}

interface SeedItemOpts {
  state?: import('@goose-hub/core/state-machine/states.js').StateName;
  priority?: Priority;
}

async function seedFeatureItem(source: InMemoryLabelsSource, opts: SeedItemOpts = {}) {
  return source.seedIssue({
    title: 'Improve onboarding',
    body: 'Make the onboarding flow better.',
    type: 'feature',
    priority: opts.priority ?? 'medium',
    state: opts.state ?? 'factory:grilling',
  });
}

function injectedConfig(perAdvisorMaxUsd = 5) {
  return {
    budgets: {
      perAdvisorMaxUsd,
      perWorkflowMaxUsd: 50,
      // The remaining budget keys aren't read by the workflow but are present
      // on the real ProjectConfig type. Cast through Pick<...,'budgets'> in
      // workflow's deps signature absorbs the extra fields.
    } as unknown as import('@goose-hub/core/types.js').ProjectConfig['budgets'],
  };
}

function getPostedPrdJson(commentBody: string): unknown {
  const match = commentBody.match(/```json\n([\s\S]*?)\n```/);
  if (match == null) throw new Error('no json fence found in comment body');
  return JSON.parse(match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Full happy path — round 1 posts a question
// ---------------------------------------------------------------------------

describe('grill-and-prd: round 1 (not ready)', () => {
  it('posts the first question, transitions to gate-pending, returns phase=grilling', async () => {
    const projectId = uniqueProjectId('round1');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:grilling' });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillRound1NotReady()]);

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('grilling');
    expect(result.questionPosted).toContain('better');

    // Comment posted with the question
    const comments = await source.listComments(item.externalId);
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments[0].body).toContain('better');
    expect(comments[0].body).toContain('Round 1');

    // State moved to gate-pending
    const updated = await source.getItem(item.externalId);
    expect(updated.state).toBe('factory:gate-pending');

    // grill.question-posted event emitted
    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const qPosted = evs.find((e) => e.kind === 'grill.question-posted');
    expect(qPosted).toBeDefined();
    expect((qPosted?.payload as { roundNumber: number }).roundNumber).toBe(1);

    // No write-prd or advisor calls happened
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Round 2 — ready for PRD, advisor skipped (priority medium)
// ---------------------------------------------------------------------------

describe('grill-and-prd: round 2 reaches PRD (advisor skipped by priority)', () => {
  it('runs grill+write-prd, posts PRD, transitions to prd-review, skips advisor', async () => {
    const projectId = uniqueProjectId('round2-skip-priority');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:gate-pending',
      priority: 'medium',
    });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady(), validPRD()]);

    const priorReplies = [
      { role: 'agent' as const, content: 'Round 1 question?' },
      { role: 'user' as const, content: 'Reduce drop-off by 20% within 30 days.' },
    ];

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('prd-review');
    expect(result.prdOutput).toBeDefined();

    // State moved to prd-review
    const updated = await source.getItem(item.externalId);
    expect(updated.state).toBe('factory:prd-review');

    // PRD posted as JSON in fenced block; verify shape
    const comments = await source.listComments(item.externalId);
    const prdComment = comments.find((c) => c.body.includes('<!-- factory:prd -->'));
    expect(prdComment).toBeDefined();
    const posted = getPostedPrdJson(prdComment?.body ?? '') as { title: string };
    expect(posted.title).toBe('Inline validation in onboarding');
    expect(prdComment?.body).not.toContain('## Advisor concerns');

    // grill.completed and prd.drafted events emitted; advisor skipped with reason 'priority'
    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    expect(evs.find((e) => e.kind === 'grill.completed')).toBeDefined();
    expect(evs.find((e) => e.kind === 'prd.drafted')).toBeDefined();
    const skipped = evs.find((e) => e.kind === 'prd.advisor-skipped');
    expect(skipped).toBeDefined();
    expect((skipped?.payload as { reason: string }).reason).toBe('priority');

    // grill-me + write-prd → 2 runtime calls (no advisor)
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Advisor runs (priority high) and revises problem statement
// ---------------------------------------------------------------------------

describe('grill-and-prd: advisor runs and revises sections', () => {
  it('merges revisedSections into the posted PRD; emits advisor decision summaries', async () => {
    const projectId = uniqueProjectId('advisor-revises');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:grilling',
      priority: 'high',
    });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady(), validPRD(), validAdvisorRevise()]);

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig(5) },
    });

    expect(result.phase).toBe('prd-review');

    // The posted PRD comment should reflect the revised `problem` and have
    // a "## Advisor concerns" section.
    const comments = await source.listComments(item.externalId);
    const prdComment = comments.find((c) => c.body.includes('<!-- factory:prd -->'));
    expect(prdComment).toBeDefined();
    const posted = getPostedPrdJson(prdComment?.body ?? '') as { problem: string };
    expect(posted.problem).toContain('38%');
    expect(prdComment?.body).toContain('## Advisor concerns');
    expect(prdComment?.body).toContain('quantify the current drop-off rate');

    // advisor decision-summary event emitted
    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const advisorDS = evs.find(
      (e) =>
        e.kind === 'agent.decision-summary' &&
        (e.payload as { skill?: string }).skill === 'advise-on-prd',
    );
    expect(advisorDS).toBeDefined();

    // grill+prd+advisor → 3 calls
    expect(runtime.run).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Advisor budget exhausted — high priority, but perAdvisorMaxUsd is 0
// ---------------------------------------------------------------------------

describe('grill-and-prd: advisor budget exhausted', () => {
  it('skips advisor with reason=budget; PRD is still drafted and posted', async () => {
    const projectId = uniqueProjectId('advisor-budget');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:grilling',
      priority: 'high',
    });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady(), validPRD()]);

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig(0) },
    });

    expect(result.phase).toBe('prd-review');

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const skipped = evs.find((e) => e.kind === 'prd.advisor-skipped');
    expect(skipped).toBeDefined();
    expect((skipped?.payload as { reason: string }).reason).toBe('budget');

    // Only grill+prd ran (no advisor)
    expect(runtime.run).toHaveBeenCalledTimes(2);

    // PRD comment exists
    const comments = await source.listComments(item.externalId);
    const prdComment = comments.find((c) => c.body.includes('<!-- factory:prd -->'));
    expect(prdComment).toBeDefined();
    expect(prdComment?.body).not.toContain('## Advisor concerns');
  });
});

// ---------------------------------------------------------------------------
// 4b. Advisor spend check — high priority, perAdvisorMaxUsd=1.0, spend=0.95
// ---------------------------------------------------------------------------

describe('grill-and-prd: advisor skipped when spend stub returns near-cap value', () => {
  it('skips advisor with reason=budget when stubbed spend (0.95) + single-run budget > perAdvisorMaxUsd (1.0)', async () => {
    const projectId = uniqueProjectId('advisor-spend-stub');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:grilling',
      priority: 'high',
    });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady(), validPRD()]);

    // perAdvisorMaxUsd=1.0; FALLBACK_ADVISOR_BUDGET.maxBudgetUsd=1.0;
    // spend stub returns 0.95 → 0.95 + 1.0 = 1.95 > 1.0 → budget unavailable
    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: {
        runtime,
        projectConfig: injectedConfig(1.0),
        totalSpendForSkill: vi.fn().mockReturnValue(0.95),
      },
    });

    expect(result.phase).toBe('prd-review');

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const skipped = evs.find((e) => e.kind === 'prd.advisor-skipped');
    expect(skipped).toBeDefined();
    expect((skipped?.payload as { reason: string }).reason).toBe('budget');

    // Only grill + write-prd ran (no advisor)
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Max grill-rounds reached — 7 prior agent rounds, skill returns ready
// ---------------------------------------------------------------------------

describe('grill-and-prd: max rounds reached, proceed straight to PRD', () => {
  it('does not ask another question and proceeds when readyForPRD=true after 7 rounds', async () => {
    const projectId = uniqueProjectId('max-rounds');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:gate-pending',
      priority: 'medium',
    });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady(), validPRD()]);

    // 7 prior agent turns + 7 user replies (alternating).
    const priorReplies = Array.from({ length: 14 }, (_, i) =>
      i % 2 === 0
        ? { role: 'agent' as const, content: `Round ${Math.floor(i / 2) + 1} question` }
        : { role: 'user' as const, content: `Round ${Math.floor(i / 2) + 1} answer` },
    );

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('prd-review');

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const completed = evs.find((e) => e.kind === 'grill.completed');
    expect(completed).toBeDefined();
    expect((completed?.payload as { rounds: number }).rounds).toBe(8); // 7 prior + this round

    // No new question-posted event
    expect(evs.find((e) => e.kind === 'grill.question-posted')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5b. Round 8 hard-cap — griller still not ready, workflow forced to PRD
// ---------------------------------------------------------------------------

describe('grill-and-prd: round-8 hard-cap forces PRD drafting', () => {
  it('forces PRD drafting on round 8 when griller returns readyForPRD=false', async () => {
    const projectId = uniqueProjectId('round8-cap');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, {
      state: 'factory:gate-pending',
      priority: 'medium',
    });
    const workItem = await source.getItem(item.externalId);

    // Griller still returns not-ready on round 8
    const grillStillNotReady = {
      questions: ['Yet another clarification question?'],
      refinedIntent: 'Improve onboarding (partially refined).',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'UNCERTAINTY', summary: 'Still uncertain after 8 rounds.' }],
    };

    const runtime = makeQueuedRuntime([grillStillNotReady, validPRD()]);

    // 7 prior agent turns (so roundNumber computes as 8)
    const priorReplies = Array.from({ length: 14 }, (_, i) =>
      i % 2 === 0
        ? { role: 'agent' as const, content: `Round ${Math.floor(i / 2) + 1} question` }
        : { role: 'user' as const, content: `Round ${Math.floor(i / 2) + 1} answer` },
    );

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies,
      deps: { runtime, projectConfig: injectedConfig() },
    });

    // Should have forced PRD drafting, not stayed in grilling
    expect(result.phase).toBe('prd-review');

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });

    // grill.completed emitted with forced:true
    const completed = evs.find((e) => e.kind === 'grill.completed');
    expect(completed).toBeDefined();
    expect((completed?.payload as { forced?: boolean }).forced).toBe(true);
    expect((completed?.payload as { rounds: number }).rounds).toBe(8);

    // No new question was posted
    expect(evs.find((e) => e.kind === 'grill.question-posted')).toBeUndefined();

    // PRD was drafted
    expect(evs.find((e) => e.kind === 'prd.drafted')).toBeDefined();

    // grill + write-prd ran; advisor skipped (medium priority)
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Schema-fail at grill step
// ---------------------------------------------------------------------------

describe('grill-and-prd: malformed grill output → needs-human', () => {
  it('forces state to factory:needs-human and returns phase=needs-human', async () => {
    const projectId = uniqueProjectId('grill-malformed');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:grilling' });
    const workItem = await source.getItem(item.externalId);

    // Missing decisionSummaries (required by the schema with .min(1))
    const malformed = {
      questions: ['Question?'],
      refinedIntent: 'Some intent.',
      readyForPRD: false,
    };

    const runtime = makeQueuedRuntime([malformed]);

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('needs-human');

    const updated = await source.getItem(item.externalId);
    expect(updated.state).toBe('factory:needs-human');

    const evs = eventStore.replay({ projectId, workItemId: workItem.id });
    const failed = evs.find((e) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect((failed?.payload as { skill: string }).skill).toBe('grill-me');
  });
});

// ---------------------------------------------------------------------------
// 7. Pre-condition guard — wrong state returns needs-human without running skills
// ---------------------------------------------------------------------------

describe('grill-and-prd: pre-condition guard', () => {
  it('returns phase=needs-human when called from a state outside the discover lane', async () => {
    const projectId = uniqueProjectId('precond-guard');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFeatureItem(source, { state: 'factory:dev-ready' });
    const workItem = await source.getItem(item.externalId);

    const runtime = makeQueuedRuntime([validGrillReady()]);

    const result = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('needs-human');
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
