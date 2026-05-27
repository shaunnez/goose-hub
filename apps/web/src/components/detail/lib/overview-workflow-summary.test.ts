import type { AgentEventDto, IssueDiffDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import type { IssueCostsBreakdown, StageBreakdown } from './costs';
import { buildOverviewWorkflowCards } from './overview-workflow-summary';

function makeItem(partial: Partial<WorkItemDto> = {}): WorkItemDto {
  return {
    id: 'wi-1',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Workflow snapshot',
    body: 'body',
    type: 'feature',
    priority: 'medium',
    mode: 'default',
    state: 'factory:triage',
    authorIsOwner: false,
    schedule: 'unplanned',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: '2026-05-20T00:00:00Z',
    ...partial,
  };
}

function makeEvent(partial: Partial<AgentEventDto> & Pick<AgentEventDto, 'kind'>): AgentEventDto {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: partial.kind,
    payload: partial.payload ?? {},
    runId: partial.runId ?? null,
    personaId: partial.personaId ?? null,
    createdAt: partial.createdAt ?? '2026-05-20T00:00:00Z',
    ...partial,
  };
}

function makeBreakdown(
  partial: Partial<StageBreakdown> & Pick<StageBreakdown, 'stage'>,
): StageBreakdown {
  return {
    stage: partial.stage,
    usd: partial.usd ?? 0,
    tokens: partial.tokens ?? 0,
    inputTokens: partial.inputTokens ?? 0,
    cachedInputTokens: partial.cachedInputTokens ?? 0,
    reasoningOutputTokens: partial.reasoningOutputTokens ?? 0,
    cacheHitRatio: partial.cacheHitRatio ?? 0,
    label: partial.label ?? 'exact',
    runCount: partial.runCount ?? 1,
  };
}

function makeCosts(
  partial: Partial<Pick<IssueCostsBreakdown, 'byStage' | 'bySkill'>> = {},
): Pick<IssueCostsBreakdown, 'byStage' | 'bySkill'> {
  return {
    byStage: partial.byStage ?? new Map(),
    bySkill: partial.bySkill ?? new Map(),
  };
}

function makeTriage(partial: Partial<TriageResultDto> = {}): TriageResultDto {
  return {
    type: 'feature',
    priority: 'high',
    candidates: [{ repo: 'shaunnez/goose-hub', confidence: 91, evidence: 'match', tier: 1 }],
    overrideRepo: null,
    ...partial,
  };
}

const DIFF: IssueDiffDto = { diff: null, runId: null };

describe('buildOverviewWorkflowCards', () => {
  it('returns six stable cards with readable empty and N/A fallbacks', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem({ type: 'bug', state: 'factory:triage' }),
      events: [],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(cards.map((card) => card.key)).toEqual([
      'triage',
      'investigation',
      'grill',
      'prd',
      'review',
      'retro',
    ]);
    expect(cards.find((card) => card.key === 'triage')?.status).toBe('Not run');
    expect(cards.find((card) => card.key === 'investigation')?.status).toBe('Not run');
    expect(cards.find((card) => card.key === 'grill')?.status).toBe('N/A');
    expect(cards.find((card) => card.key === 'prd')?.status).toBe('N/A');
    expect(cards.find((card) => card.key === 'review')?.status).toBe('Not run');
    expect(cards.find((card) => card.key === 'retro')?.status).toBe('Not run');
  });

  it('summarizes triage routing details and stage cost', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem(),
      events: [],
      costs: makeCosts({
        byStage: new Map([
          ['triage', makeBreakdown({ stage: 'triage', usd: 0.03, tokens: 1200, label: 'exact' })],
        ]),
      }),
      diff: DIFF,
      triage: makeTriage({
        type: 'bug',
        priority: 'critical',
        candidates: [
          { repo: 'shaunnez/goose-hub', confidence: 86, evidence: 'signal', tier: 1 },
          { repo: 'shaunnez/other', confidence: 33, evidence: 'fallback', tier: 2 },
        ],
        overrideRepo: 'shaunnez/manual',
      }),
    });

    const triage = cards[0];
    expect(triage.status).toBe('Complete');
    expect(triage.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Priority', value: 'critical' }),
        expect.objectContaining({ label: 'Type', value: 'bug' }),
        expect.objectContaining({ label: 'Repo', value: 'shaunnez/manual' }),
        expect.objectContaining({ label: 'Confidence', value: '86%' }),
        expect.objectContaining({ label: 'Candidates', value: '2' }),
        expect.objectContaining({ label: 'Override', value: 'Yes' }),
      ]),
    );
    expect(triage.footer).toEqual({ tokens: 1200, usd: 0.03, label: 'exact' });
  });

  it('uses skill costs to split discover-lane Grill and PRD summaries', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem({ state: 'factory:prd-review' }),
      events: [
        makeEvent({ kind: 'grill.question-posted', id: 1, payload: { roundNumber: 1 } }),
        makeEvent({ kind: 'grill.completed', id: 2, payload: { rounds: 2, forced: true } }),
        makeEvent({
          kind: 'prd.drafted',
          id: 3,
          payload: {
            prd: {
              estimatedComplexity: 'medium',
              acceptanceCriteria: [{ id: 'AC-1' }],
              journeys: [{ id: 'J-1' }],
              verticalSlices: [{ title: 'Slice 1' }],
            },
          },
        }),
      ],
      costs: makeCosts({
        byStage: new Map([
          [
            'discover',
            makeBreakdown({ stage: 'discover', usd: 0.4, tokens: 5000, label: 'estimated' }),
          ],
        ]),
        bySkill: new Map([
          [
            'grill-me',
            makeBreakdown({ stage: 'discover', usd: 0.11, tokens: 1200, label: 'exact' }),
          ],
          [
            'write-prd',
            makeBreakdown({ stage: 'discover', usd: 0.29, tokens: 3800, label: 'estimated' }),
          ],
        ]),
      }),
      diff: DIFF,
      triage: null,
    });

    expect(cards.find((card) => card.key === 'grill')?.footer).toEqual({
      tokens: 1200,
      usd: 0.11,
      label: 'exact',
    });
    expect(cards.find((card) => card.key === 'prd')?.footer).toEqual({
      tokens: 3800,
      usd: 0.29,
      label: 'estimated',
    });
    expect(cards.find((card) => card.key === 'grill')?.status).toBe('Force completed');
    expect(cards.find((card) => card.key === 'prd')?.status).toBe('In review');
  });

  it('counts PRD acceptance criteria, journeys, slices, and advisor concerns from prd.drafted only', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem({ state: 'factory:prd-review' }),
      events: [
        makeEvent({
          kind: 'prd.drafted',
          id: 4,
          payload: {
            prd: {
              estimatedComplexity: 'high',
              acceptanceCriteria: [{ id: 'AC-1' }, { id: 'AC-2' }, { id: 'AC-3' }],
              journeys: [{ id: 'J-1' }, { id: 'J-2' }],
              verticalSlices: [{ title: 'Slice 1' }, { title: 'Slice 2' }],
            },
            advisorConcerns: '- first\n- second',
          },
        }),
      ],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(cards.find((card) => card.key === 'prd')?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Complexity', value: 'high' }),
        expect.objectContaining({ label: 'ACs', value: '3' }),
        expect.objectContaining({ label: 'Journeys', value: '2' }),
        expect.objectContaining({ label: 'Slices', value: '2' }),
        expect.objectContaining({ label: 'Advisor', value: '2' }),
      ]),
    );
  });

  it('uses the latest matching event and computes review severity counts', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem({ state: 'factory:done' }),
      events: [
        makeEvent({
          kind: 'review.completed',
          id: 10,
          createdAt: '2026-05-20T01:00:00Z',
          payload: {
            verdict: 'approved',
            confidence: 0.91,
            criteriaChecks: [{ criterion: 'AC-1', status: 'met' }],
            findings: [],
          },
        }),
        makeEvent({
          kind: 'review.completed',
          id: 11,
          createdAt: '2026-05-20T02:00:00Z',
          payload: {
            verdict: 'needs-fix',
            confidence: 0.66,
            criteriaChecks: [
              { criterion: 'AC-1', status: 'met' },
              { criterion: 'AC-2', status: 'unmet' },
              { criterion: 'AC-3', status: 'met' },
            ],
            findings: [
              { severity: 'blocker', description: 'a' },
              { severity: 'major', description: 'b' },
              { severity: 'major', description: 'c' },
              { severity: 'minor', description: 'd' },
            ],
          },
        }),
        makeEvent({
          kind: 'pr.opened',
          id: 12,
          payload: { prNumber: 55, prUrl: 'https://example.test/pr/55' },
        }),
      ],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(cards.find((card) => card.key === 'review')).toEqual(
      expect.objectContaining({
        status: 'Needs fix',
        metrics: expect.arrayContaining([
          expect.objectContaining({ label: 'Confidence', value: '66%' }),
          expect.objectContaining({ label: 'Criteria', value: '2/3 met' }),
          expect.objectContaining({ label: 'Blockers', value: '1' }),
          expect.objectContaining({ label: 'Major', value: '2' }),
          expect.objectContaining({ label: 'Minor', value: '1' }),
          expect.objectContaining({ label: 'PR', value: '#55 open' }),
        ]),
      }),
    );
  });

  it('prefers latest createdAt and id when selecting investigation data', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem(),
      events: [
        makeEvent({
          kind: 'agent.tool-call',
          id: 6,
          runId: 'older-run',
          payload: { tool_name: 'Read' },
        }),
        makeEvent({
          kind: 'agent.investigation-complete',
          id: 8,
          runId: 'older-run',
          createdAt: '2026-05-20T03:00:00Z',
          payload: {
            investigate: {
              findings: 'older',
              keyFiles: [{ path: 'a.ts', reason: 'a' }],
              confidence: 'low',
              openQuestions: ['one'],
              decisionSummaries: [],
            },
          },
        }),
        makeEvent({
          kind: 'agent.tool-call',
          id: 9,
          runId: 'latest-run',
          payload: { tool_name: 'Read' },
        }),
        makeEvent({
          kind: 'agent.tool-call',
          id: 10,
          runId: 'latest-run',
          payload: { tool_name: 'Grep' },
        }),
        makeEvent({
          kind: 'agent.tool-call',
          id: 11,
          runId: 'post-review-run',
          payload: { tool_name: 'Read' },
        }),
        makeEvent({
          kind: 'agent.tool-call',
          id: 12,
          runId: 'post-review-run',
          payload: { tool_name: 'Grep' },
        }),
        makeEvent({
          kind: 'agent.investigation-complete',
          id: 7,
          runId: 'latest-run',
          createdAt: '2026-05-20T04:00:00Z',
          payload: {
            investigate: {
              findings: 'newer',
              keyFiles: [
                { path: 'b.ts', reason: 'b' },
                { path: 'c.ts', reason: 'c' },
              ],
              confidence: 'high',
              openQuestions: [],
              decisionSummaries: [],
            },
            playwrightRepro: {
              reproduced: true,
              screenshots: [],
              gifPath: null,
              consoleErrors: [],
              reproSteps: [],
            },
          },
        }),
      ],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(cards.find((card) => card.key === 'investigation')?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Confidence', value: 'high' }),
        expect.objectContaining({ label: 'Key files', value: '2' }),
        expect.objectContaining({ label: 'Questions', value: '0' }),
        expect.objectContaining({ label: 'Reads', value: '1' }),
        expect.objectContaining({ label: 'Searches', value: '1' }),
        expect.objectContaining({ label: 'Repro', value: 'Reproduced' }),
      ]),
    );
  });

  it('distinguishes light versus deep retrospectives', () => {
    const lightCards = buildOverviewWorkflowCards({
      item: makeItem(),
      events: [
        makeEvent({
          kind: 'retrospective.completed',
          id: 20,
          payload: {
            tier: 'light',
            output: {
              outcome: 'partial',
              workItemNumber: 42,
              summary: { wentWell: '', didNotGoWell: '', architecturalTakeaway: '' },
              improvementCandidates: [
                { kind: 'workflow', targetPath: 'a', suggestionText: 'a', confidence: 'high' },
                { kind: 'persona', targetPath: 'b', suggestionText: 'b', confidence: 'low' },
              ],
              decisionSummaries: [],
            },
          },
        }),
      ],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    const deepCards = buildOverviewWorkflowCards({
      item: makeItem(),
      events: [
        makeEvent({
          kind: 'retrospective.completed',
          id: 21,
          payload: {
            tier: 'deep',
            output: {
              outcome: 'success',
              workItemNumber: 42,
              summary: { wentWell: '', didNotGoWell: '', architecturalTakeaway: '' },
              improvementCandidates: [
                { kind: 'workflow', targetPath: 'a', suggestionText: 'a', confidence: 'high' },
              ],
              decisionSummaries: [],
              triggerReasons: ['quality'],
              personaQualityScores: [
                { personaId: 'p1', score: 0.9, trend: 'improving', sampleCount: 1 },
              ],
              learningEntries: [
                {
                  observation: 'o',
                  rationale: 'r',
                  improvementKind: 'workflow',
                  confidence: 'medium',
                },
              ],
              decisionPatterns: [{ pattern: 'p', occurrences: 2, confidence: 'high' }],
            },
          },
        }),
      ],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(lightCards.find((card) => card.key === 'retro')).toEqual(
      expect.objectContaining({
        status: 'Partial',
        metrics: expect.arrayContaining([
          expect.objectContaining({ label: 'Candidates', value: '2' }),
          expect.objectContaining({ label: 'High conf', value: '1' }),
        ]),
      }),
    );
    expect(deepCards.find((card) => card.key === 'retro')).toEqual(
      expect.objectContaining({
        status: 'Success',
        metrics: expect.arrayContaining([
          expect.objectContaining({ label: 'Quality', value: '1' }),
          expect.objectContaining({ label: 'Patterns', value: '1' }),
          expect.objectContaining({ label: 'Learnings', value: '1' }),
        ]),
      }),
    );
  });

  it('keeps PRD sparse and event-only when no prd.drafted event exists', () => {
    const cards = buildOverviewWorkflowCards({
      item: makeItem({ state: 'factory:prd-review' }),
      events: [makeEvent({ kind: 'prd.revised', payload: { concerns: ['More detail'] } })],
      costs: makeCosts(),
      diff: DIFF,
      triage: null,
    });

    expect(cards.find((card) => card.key === 'prd')).toEqual(
      expect.objectContaining({
        status: 'Revised',
        metrics: expect.arrayContaining([
          expect.objectContaining({ label: 'Complexity', value: 'N/A' }),
          expect.objectContaining({ label: 'ACs', value: 'N/A' }),
        ]),
      }),
    );
  });
});
