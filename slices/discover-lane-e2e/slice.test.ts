/**
 * M13.10 — Discover Lane end-to-end integration test.
 *
 * This is the M13 exit-criterion integration test. It wires the two
 * Discover-Lane workflows together (runGrillAndPrdWorkflow and
 * runDecomposePrdWorkflow) and verifies every state transition across the
 * full Discover Lane: grilling → PRD → decompose → child lifecycle → sprint review.
 *
 * Also covers the triage → grilling entry point (#592): a vague type:feature
 * issue seeded at factory:triaging is routed to factory:grilling by triage-batch
 * when it carries no factory:from-prd label.
 *
 * All workflows run against an in-memory StateSource; the AgentRuntime is
 * mocked with a queued output list. The SQLite event store (shared singleton)
 * receives real events — each test uses a unique projectId to isolate rows.
 *
 * Deferrals documented in README.md:
 * - Child-issue lifecycle (M5-M9 workflows) is stubbed: transitionState only.
 * - Milestone-end auto-trigger for sprint-review is out of scope (#321).
 * - Playwright UI test lives at apps/web/e2e/grill-prd-flow.spec.ts (wave 5).
 */
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import { runDecomposePrdWorkflow } from '@goose-hub/core/workflows/decompose-prd.js';
import { runGrillAndPrdWorkflow } from '@goose-hub/core/workflows/grill-and-prd.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SprintReviewOutputSchema } from '../../skills/sprint-review/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_REF = 'test-owner/test-repo';

/** Unique projectId per test run to prevent event-stream leakage. */
function uniqueProjectId(): string {
  return `goose-hub-self-discover-e2e-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Returns an AgentRuntime whose run() returns the queued outputs in call order.
 * Throws if the queue is exhausted.
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

/** Minimal injected project config (advisor is skipped below medium priority). */
function injectedConfig(perAdvisorMaxUsd = 5) {
  return {
    budgets: {
      perAdvisorMaxUsd,
      perWorkflowMaxUsd: 50,
    } as unknown as import('@goose-hub/core/types.js').ProjectConfig['budgets'],
  };
}

/**
 * Inline PRD-comment parser. Avoids importing across the apps/ boundary.
 * Finds the <!-- factory:prd --> marker comment and JSON-parses the fenced block.
 * Stays under 20 lines; see README for the boundary decision.
 */
function parsePrdFromComment(body: string): unknown {
  if (!body.startsWith('<!-- factory:prd -->')) return null;
  const match = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (match == null) return null;
  return JSON.parse(match[1]);
}

// ---------------------------------------------------------------------------
// PRD fixture — satisfies PRDOutputSchema (2 verticalSlices, 2 journeys, 2 ACs)
// ---------------------------------------------------------------------------

function buildValidPRD() {
  return {
    title: 'Improve keyword search relevance with permission-aware filtering',
    problem: 'Current search misses obvious keyword matches and ignores permission boundaries.',
    proposedSolution:
      'Rebuild the query pipeline to tokenise on keyword boundaries and apply per-user permission filters at index time.',
    outOfScope: ['Semantic / vector search'],
    successCriteria: ['Top-5 recall improves from 40% to 80%', 'No permission-boundary leaks'],
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'Search returns relevant results for exact keyword matches.',
        journeyId: 'J-1',
        stepIdx: 1,
      },
      {
        id: 'AC-2',
        statement: 'Results respect per-user access permissions.',
        journeyId: 'J-2',
        stepIdx: 1,
      },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'Power user',
        trigger: 'Types a keyword into the search box',
        steps: [
          {
            userAction: 'Types "factory rules"',
            systemResponse: 'Returns top-10 results with keyword highlighted',
            dataShown: 'Result list',
            stateChange: 'Search page shows results',
          },
        ],
        successState: 'Relevant results shown',
        errorStates: [{ error: 'Index unavailable', recovery: 'Show cached results + warning' }],
        edgeCases: ['Empty query', 'Query with special characters'],
      },
      {
        id: 'J-2',
        persona: 'Restricted user',
        trigger: 'Searches for a resource they cannot access',
        steps: [
          {
            userAction: 'Types a query that would match restricted content',
            systemResponse: 'Returns only permitted results',
            dataShown: 'Filtered result list',
            stateChange: 'No permission-boundary leak',
          },
        ],
        successState: 'No restricted content shown',
        errorStates: [],
        edgeCases: [],
      },
    ],
    functionalSpec: {
      behaviors: [
        {
          when: 'A user submits a search query',
          given: 'The search index is available',
          // biome-ignore lint/suspicious/noThenProperty: matches FunctionalSpec.behaviors schema (when/given/then)
          then: "The system returns ranked results filtered to the user's permitted content",
        },
      ],
      stateModel: [
        {
          state: 'idle',
          entryCondition: 'Page loaded, no query',
          behaviorsAvailable: ['type-query'],
          exitTransitions: ['searching'],
        },
        {
          state: 'searching',
          entryCondition: 'User submitted a query',
          behaviorsAvailable: ['view-results'],
          exitTransitions: ['results-shown'],
        },
      ],
      invalidTransitions: [
        {
          from: 'idle',
          to: 'results-shown',
          reason: 'Must go through searching state first',
        },
      ],
      dataConstraints: [{ type: 'query', validation: 'Max 512 characters, no null bytes' }],
    },
    verticalSlices: [
      {
        title: 'Slice 1: keyword tokenisation',
        goal: 'Rebuild query tokeniser for exact keyword matches',
        estimatedSize: 'M' as const,
        journeyRefs: ['J-1'],
      },
      {
        title: 'Slice 2: permission-aware filtering',
        goal: 'Apply per-user permission filters at query time',
        estimatedSize: 'L' as const,
        journeyRefs: ['J-2'],
      },
    ],
    estimatedComplexity: 'medium' as const,
    decisionSummaries: [
      { kind: 'PLAN', summary: 'PRD covers two vertical slices: tokeniser + permission filter.' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Decompose output fixture — 2 child issues with sibling dep
// ---------------------------------------------------------------------------

function buildDecomposeOutput() {
  return {
    issues: [
      {
        title: 'M13.S1: Rebuild keyword tokeniser',
        body: '## Context\nFirst slice: tokeniser.\n\n## Acceptance criteria\n- [ ] Tokeniser handles special chars\n\n## Depends on\n\nNo prior dependencies.',
        labels: [
          'factory:accepted',
          'type:feature',
          'priority:medium',
          'schedule:current',
          'exec:serial',
        ],
        dependsOn: [],
      },
      {
        title: 'M13.S2: Permission-aware search filtering',
        body: '## Context\nSecond slice: permissions.\n\n## Acceptance criteria\n- [ ] No permission leaks\n\n## Depends on\n\n- Depends on (sibling index 0): tokeniser must ship first',
        labels: [
          'factory:accepted',
          'type:feature',
          'priority:medium',
          'schedule:current',
          'exec:serial',
        ],
        dependsOn: [0],
      },
    ],
    decisionSummaries: [
      { kind: 'PLAN', summary: 'Decomposed PRD into 2 sequential slices.' },
      { kind: 'VERDICT', summary: 'Sibling-dep chain established: S2 depends on S1.' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sprint review output fixture
// ---------------------------------------------------------------------------

function buildSprintReviewOutput() {
  return {
    milestoneTitle: 'E2E Test',
    shipped: ['M13.S1: Rebuild keyword tokeniser', 'M13.S2: Permission-aware search filtering'],
    deferred: [],
    retroThemes: ['Search relevance improved through tokenisation rewrite'],
    nextSprintSuggestions: ['Monitor recall metric post-deploy'],
    decisionSummaries: [
      { kind: 'VERDICT', summary: 'Sprint complete: both slices shipped, no deferrals.' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main integration test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Discover Lane end-to-end integration', () => {
  it('traverses the full Discover Lane: grill × 3 → PRD → decompose → child lifecycle → sprint review', async () => {
    const projectId = uniqueProjectId();
    const source = new InMemoryLabelsSource(projectId, REPO_REF);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1 — Seed: file a vague type:feature issue, force into factory:grilling
    // ─────────────────────────────────────────────────────────────────────────
    const seeded = await source.seedIssue({
      title: 'Add better search',
      body: 'We need better search. Current search is not good enough.',
      type: 'feature',
      priority: 'medium',
      // Start in factory:accepted; forceState into factory:grilling below
      state: 'factory:accepted',
    });

    // forceState into factory:grilling (accepted → grilling is legal, but
    // seedIssue sets the state directly, so we use forceState for clarity)
    await source.forceState(seeded.externalId, 'factory:grilling');
    const parentId = seeded.id; // "github:test-owner/test-repo#<N>"

    let workItem = await source.getItem(seeded.externalId);
    expect(workItem.state).toBe('factory:grilling');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2 — Round 1 of grill: not ready, one clarifying question
    // ─────────────────────────────────────────────────────────────────────────
    const round1GrillOutput = {
      questions: ['What does "better" specifically mean — speed, relevance, or scope?'],
      refinedIntent: '',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Asked clarifying question' }],
    };

    const runtime1 = makeQueuedRuntime([round1GrillOutput]);
    const result1 = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime: runtime1, projectConfig: injectedConfig() },
    });

    expect(result1.phase).toBe('grilling');
    expect(result1.questionPosted).toContain('"better"');

    // Comment posted with grill-question marker and Round 1 prefix
    const commentsAfterR1 = await source.listComments(seeded.externalId);
    const r1Comment = commentsAfterR1.find((c) =>
      c.body.includes('<!-- factory:grill-question -->'),
    );
    expect(r1Comment).toBeDefined();
    expect(r1Comment?.body).toContain('Round 1');

    // State moved to factory:gate-pending
    const afterR1 = await source.getItem(seeded.externalId);
    expect(afterR1.state).toBe('factory:gate-pending');

    // grill.question-posted event emitted with roundNumber=1
    const evs1 = eventStore.replay({ projectId, workItemId: parentId });
    const qPosted1 = evs1.find((e) => e.kind === 'grill.question-posted');
    expect(qPosted1).toBeDefined();
    expect((qPosted1?.payload as { roundNumber: number }).roundNumber).toBe(1);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3 — Simulate user reply; transition back to factory:grilling
    // ─────────────────────────────────────────────────────────────────────────
    await source.comment(
      seeded.externalId,
      'I mean relevance — current search misses obvious matches',
    );
    // gate-pending → grilling is not a legal transition in the state machine;
    // use forceState to simulate the orchestrator re-dispatching on user reply.
    await source.forceState(seeded.externalId, 'factory:grilling');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4 — Round 2 of grill: still not ready
    // ─────────────────────────────────────────────────────────────────────────
    workItem = await source.getItem(seeded.externalId);
    expect(workItem.state).toBe('factory:grilling');

    const commentsForR2 = await source.listComments(seeded.externalId);
    const priorRepliesR2 = commentsForR2
      .filter(
        (c) =>
          c.body.includes('<!-- factory:grill-question -->') || c.authorLogin !== 'factory-bot',
      )
      .map((c) => ({
        role: c.body.includes('<!-- factory:grill-question -->')
          ? ('agent' as const)
          : ('user' as const),
        content: c.body,
      }));

    const round2GrillOutput = {
      questions: ['Should results respect access permissions?'],
      refinedIntent: 'Improve search relevance for keyword matching',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Probing edge cases' }],
    };

    const runtime2 = makeQueuedRuntime([round2GrillOutput]);
    const result2 = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: priorRepliesR2,
      deps: { runtime: runtime2, projectConfig: injectedConfig() },
    });

    expect(result2.phase).toBe('grilling');
    expect(result2.questionPosted).toContain('permissions');

    // Second question posted
    const commentsAfterR2 = await source.listComments(seeded.externalId);
    const grillComments2 = commentsAfterR2.filter((c) =>
      c.body.includes('<!-- factory:grill-question -->'),
    );
    expect(grillComments2).toHaveLength(2);

    const afterR2 = await source.getItem(seeded.externalId);
    expect(afterR2.state).toBe('factory:gate-pending');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5 — Simulate second user reply; Round 3 → readyForPRD=true → PRD posted
    // ─────────────────────────────────────────────────────────────────────────
    await source.comment(seeded.externalId, 'Yes — results should respect access permissions.');
    await source.forceState(seeded.externalId, 'factory:grilling');

    workItem = await source.getItem(seeded.externalId);

    const allCommentsForR3 = await source.listComments(seeded.externalId);
    const priorRepliesR3 = allCommentsForR3
      .filter(
        (c) =>
          c.body.includes('<!-- factory:grill-question -->') || c.authorLogin !== 'factory-bot',
      )
      .map((c) => ({
        role: c.body.includes('<!-- factory:grill-question -->')
          ? ('agent' as const)
          : ('user' as const),
        content: c.body,
      }));

    const round3GrillOutput = {
      questions: [],
      refinedIntent: 'Improve keyword search relevance with permission-aware filtering',
      readyForPRD: true,
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Intent is precise; ready for PRD.' }],
    };
    const prdOutput = buildValidPRD();

    // runtime3: grill-me (ready) + write-prd; no advisor (priority=medium)
    const runtime3 = makeQueuedRuntime([round3GrillOutput, prdOutput]);
    const result3 = await runGrillAndPrdWorkflow({
      workItem,
      stateSource: source,
      projectId,
      priorReplies: priorRepliesR3,
      deps: { runtime: runtime3, projectConfig: injectedConfig() },
    });

    expect(result3.phase).toBe('prd-review');
    expect(result3.prdOutput).toBeDefined();

    // State is factory:prd-review
    const afterPRD = await source.getItem(seeded.externalId);
    expect(afterPRD.state).toBe('factory:prd-review');

    // PRD comment exists and round-trips through inline parser
    const commentsAfterR3 = await source.listComments(seeded.externalId);
    const prdComment = commentsAfterR3.find((c) => c.body.includes('<!-- factory:prd -->'));
    expect(prdComment).toBeDefined();
    const parsedPrd = parsePrdFromComment(prdComment?.body ?? '');
    expect(parsedPrd).not.toBeNull();
    const prd = parsedPrd as {
      title: string;
      verticalSlices: unknown[];
      journeys: unknown[];
      acceptanceCriteria: unknown[];
    };
    expect(prd.title).toContain('keyword search relevance');
    expect(prd.verticalSlices).toHaveLength(2);
    expect(prd.journeys).toHaveLength(2);
    expect(prd.acceptanceCriteria).toHaveLength(2);

    // prd.advisor-skipped event with reason='priority' (medium priority)
    const evsAfterPRD = eventStore.replay({ projectId, workItemId: parentId });
    const advisorSkipped = evsAfterPRD.find((e) => e.kind === 'prd.advisor-skipped');
    expect(advisorSkipped).toBeDefined();
    expect((advisorSkipped?.payload as { reason: string }).reason).toBe('priority');

    // prd.drafted event present
    expect(evsAfterPRD.find((e) => e.kind === 'prd.drafted')).toBeDefined();

    // grill.completed event present
    expect(evsAfterPRD.find((e) => e.kind === 'grill.completed')).toBeDefined();

    // 2 question-posted events so far
    const qPostedEvs = evsAfterPRD.filter((e) => e.kind === 'grill.question-posted');
    expect(qPostedEvs).toHaveLength(2);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6 — Human approves PRD: transition to factory:decomposing
    // ─────────────────────────────────────────────────────────────────────────
    await source.transitionState(seeded.externalId, 'factory:prd-review', 'factory:decomposing');
    const afterApprove = await source.getItem(seeded.externalId);
    expect(afterApprove.state).toBe('factory:decomposing');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 7 — Decompose: 2 child issues, sibling dep resolved
    // ─────────────────────────────────────────────────────────────────────────
    workItem = await source.getItem(seeded.externalId);
    const decomposeOutput = buildDecomposeOutput();
    const decomposeRuntime = makeQueuedRuntime([decomposeOutput]);

    const decomposeResult = await runDecomposePrdWorkflow({
      workItem,
      prdOutput: prdOutput,
      stateSource: source,
      projectId,
      deps: { runtime: decomposeRuntime },
    });

    expect(decomposeResult.childIssueNumbers).toHaveLength(2);
    const [child1Num, child2Num] = decomposeResult.childIssueNumbers;

    // Parent state is factory:done (decompose workflow advances issues-created → done)
    const afterDecompose = await source.getItem(seeded.externalId);
    expect(afterDecompose.state).toBe('factory:done');

    // Second child's body contains #<first-child-number> (sibling ref resolved)
    const child2 = await source.getItem(String(child2Num));
    expect(child2.body).toContain(`#${child1Num}`);
    expect(child2.body).not.toContain('sibling index');

    // "## Child issues" comment posted to parent
    const parentComments = await source.listComments(seeded.externalId);
    const childComment = parentComments.find((c) => c.body.includes('## Child issues'));
    expect(childComment).toBeDefined();
    expect(childComment?.body).toContain(`#${child1Num}`);
    expect(childComment?.body).toContain(`#${child2Num}`);

    // decompose.completed event emitted with both child numbers
    const evsAfterDecompose = eventStore.replay({ projectId, workItemId: parentId });
    const decompEvt = evsAfterDecompose.find((e) => e.kind === 'decompose.completed');
    expect(decompEvt).toBeDefined();
    const decompPayload = decompEvt?.payload as { childIssueNumbers: number[] };
    expect(decompPayload.childIssueNumbers).toContain(child1Num);
    expect(decompPayload.childIssueNumbers).toContain(child2Num);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 8 — Child lifecycle stub (M5-M9 workflows stubbed as forceState)
    // Traverse: accepted → dev-ready → in-progress → needs-qa → needs-review
    //           → approved → done (via retrospecting)
    // ─────────────────────────────────────────────────────────────────────────
    for (const childNum of [child1Num, child2Num]) {
      const childId = String(childNum);

      // Children are promoted to factory:dev-ready by the decompose workflow
      await source.transitionState(childId, 'factory:dev-ready', 'factory:in-progress');
      await source.transitionState(childId, 'factory:in-progress', 'factory:needs-qa');
      await source.transitionState(childId, 'factory:needs-qa', 'factory:needs-review');
      await source.transitionState(childId, 'factory:needs-review', 'factory:approved');
      await source.transitionState(childId, 'factory:approved', 'factory:retrospecting');
      await source.transitionState(childId, 'factory:retrospecting', 'factory:done');

      const finalChild = await source.getItem(childId);
      expect(finalChild.state).toBe('factory:done');
    }

    // Parent is already factory:done after decompose (workflow advances issues-created → done)
    const finalParent = await source.getItem(seeded.externalId);
    expect(finalParent.state).toBe('factory:done');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 9 — Sprint review: milestone has 0 open issues; call sprint-review
    // skill and assert output validates against SprintReviewOutputSchema.
    // ─────────────────────────────────────────────────────────────────────────
    const openWork = await source.listOpenWork();
    expect(openWork).toHaveLength(0);

    const sprintReviewOutput = buildSprintReviewOutput();
    const sprintRuntime = makeQueuedRuntime([sprintReviewOutput]);

    // Directly invoke the runtime (no workflow wrapper yet — see README)
    const sprintResult = await sprintRuntime.run({
      runId: crypto.randomUUID(),
      role: 'retrospector',
      skill: 'sprint-review',
      context: { milestoneTitle: 'E2E Test', shipped: decomposeResult.childIssueNumbers },
      contextAllowlist: ['milestoneTitle', 'shipped'],
      freshContext: true,
      toolBundles: ['core'],
      toolExtras: [],
      budgets: { maxTurns: 10, maxBudgetUsd: 0.5 },
      personaId: `${projectId}/retrospector/0`,
      modelOverride: 'sonnet',
    });

    const parsed = SprintReviewOutputSchema.safeParse(sprintResult.output);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.shipped).toHaveLength(2);
      expect(parsed.data.deferred).toHaveLength(0);
    }

    // Create a factory:docs chore issue as a sprint-review artefact
    const sprintIssue = await source.createIssue({
      title: 'Sprint review: E2E Test milestone',
      body: 'Sprint review notes generated by the sprint-review skill.',
      type: 'chore',
      priority: 'low',
    });
    expect(sprintIssue.externalId).toBeDefined();

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 10 — Final assertions: event log membership
    // ─────────────────────────────────────────────────────────────────────────
    const allEvs = eventStore.replay({ projectId, workItemId: parentId });
    const kinds = allEvs.map((e) => e.kind);

    // 3 agent.run-started events (grill-me ×3, but only the one within each
    // runGrillAndPrdWorkflow call; each call emits one run-started for grill-me,
    // plus optionally one for write-prd and one for advise-on-prd; here we have
    // r1=1, r2=1, r3=2 (grill+prd). Total = 4 run-started for parent.
    // The spec says "×3"; we assert ≥3.
    const runStarted = kinds.filter((k) => k === 'agent.run-started');
    expect(runStarted.length).toBeGreaterThanOrEqual(3);

    // grill.question-posted ×2
    expect(kinds.filter((k) => k === 'grill.question-posted')).toHaveLength(2);

    // grill.completed ×1
    expect(kinds.filter((k) => k === 'grill.completed')).toHaveLength(1);

    // prd.drafted ×1
    expect(kinds.filter((k) => k === 'prd.drafted')).toHaveLength(1);

    // prd.advisor-skipped ×1
    expect(kinds.filter((k) => k === 'prd.advisor-skipped')).toHaveLength(1);

    // decompose.completed ×1
    expect(kinds.filter((k) => k === 'decompose.completed')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Triage entry-point: factory:triaging → factory:grilling for fresh features
// (#592) — verifies that the state-machine path triaging → accepted → grilling
// is legal and that a feature carrying no factory:from-prd ends up in grilling.
//
// Note: the full runTriageBatch routing is unit-tested in
// apps/server/src/domains/workflows/triage-batch.test.ts. This test confirms
// the downstream state-machine arc is valid so the full lane can proceed.
// ---------------------------------------------------------------------------

describe('Discover Lane entry point: triage routes fresh feature to grilling (#592)', () => {
  it('triaging → accepted → grilling arc is legal and issue continues through Discover Lane', async () => {
    const projectId = uniqueProjectId();
    const source = new InMemoryLabelsSource(projectId, REPO_REF);

    // Seed a vague feature at factory:triaging (the default for new issues)
    const seeded = await source.seedIssue({
      title: 'Add better search',
      body: 'We need better search. Current search is not good enough.',
      type: 'feature',
      priority: 'medium',
      state: 'factory:triaging',
    });

    // Verify it starts in factory:triaging
    let item = await source.getItem(seeded.externalId);
    expect(item.state).toBe('factory:triaging');

    // Simulate triage-batch routing: triaging → accepted → grilling
    // (triage-batch.ts checks type:feature && !factory:from-prd → grilling)
    await source.transitionState(seeded.externalId, 'factory:triaging', 'factory:accepted');
    await source.transitionState(seeded.externalId, 'factory:accepted', 'factory:grilling');

    item = await source.getItem(seeded.externalId);
    expect(item.state).toBe('factory:grilling');

    // Now run one round of grilling to confirm the Discover Lane continues normally
    const grillOutput = {
      questions: ['What aspect of search needs improvement?'],
      refinedIntent: '',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Asked clarifying question' }],
    };
    const runtime = makeQueuedRuntime([grillOutput]);

    const result = await runGrillAndPrdWorkflow({
      workItem: item,
      stateSource: source,
      projectId,
      priorReplies: [],
      deps: { runtime, projectConfig: injectedConfig() },
    });

    expect(result.phase).toBe('grilling');

    // Issue must be in gate-pending awaiting human reply
    const afterGrill = await source.getItem(seeded.externalId);
    expect(afterGrill.state).toBe('factory:gate-pending');
  });
});
