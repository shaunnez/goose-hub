import type { AgentEventDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import type { IssueCostsBreakdown, StageBreakdown } from './costs';
import { buildOverviewWorkflowSummary } from './overview-workflow-summary';

function makeItem(partial: Partial<WorkItemDto> = {}): WorkItemDto {
  return {
    id: 'wi-1',
    externalId: '1112',
    repoRef: 'owner/repo',
    title: 'Workflow snapshot',
    body: 'Body',
    type: 'bug',
    priority: 'medium',
    mode: 'default',
    state: 'factory:triaging',
    authorIsOwner: false,
    schedule: 'normal',
    exec: 'idle',
    dependsOn: [],
    blocks: [],
    createdAt: '2026-05-27T00:00:00.000Z',
    ...partial,
  };
}

function makeEvent(
  id: number,
  kind: string,
  payload: AgentEventDto['payload'] = {},
  partial: Partial<AgentEventDto> = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload,
    runId: null,
    personaId: null,
    createdAt: new Date(Date.UTC(2026, 4, 27, 0, 0, id)).toISOString(),
    ...partial,
  };
}

function stage(
  stage: StageBreakdown['stage'],
  partial: Partial<StageBreakdown> = {},
): StageBreakdown {
  return {
    stage,
    usd: 0.12,
    tokens: 1200,
    inputTokens: 900,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    cacheHitRatio: 0,
    label: 'exact',
    runCount: 1,
    ...partial,
  };
}

function costs(partial: Partial<IssueCostsBreakdown> = {}): IssueCostsBreakdown {
  const byStage = new Map<StageBreakdown['stage'], StageBreakdown>();
  const bySkill = new Map<string, StageBreakdown>();
  return {
    byRun: new Map(),
    byStage,
    bySkill,
    total: 0,
    totalTokens: 0,
    hasEstimated: false,
    totalLabel: 'exact',
    runCount: 0,
    isLoading: false,
    ...partial,
  } as IssueCostsBreakdown;
}

describe('buildOverviewWorkflowSummary', () => {
  it('returns six cards in stable order with discover N/A when no discover activity exists', () => {
    const cards = buildOverviewWorkflowSummary({
      item: makeItem(),
      events: [],
      costs: costs(),
    });

    expect(cards.map((card) => card.key)).toEqual([
      'triage',
      'investigation',
      'grill',
      'prd',
      'review',
      'retro',
    ]);

    expect(cards.find((card) => card.key === 'triage')).toMatchObject({ status: 'Not run' });
    expect(cards.find((card) => card.key === 'grill')).toMatchObject({
      status: 'N/A',
      statusTone: 'muted',
    });
    expect(cards.find((card) => card.key === 'prd')).toMatchObject({
      status: 'N/A',
      statusTone: 'muted',
    });
  });

  it('summarizes canonical triage metrics and stage cost', () => {
    const triage = {
      priority: 'high',
      type: 'feature',
      repo: 'goose-hub/web',
      confidence: 0.82,
      override: true,
      candidates: [{ repo: 'goose-hub/web' }, { repo: 'goose-hub/server' }],
    } as unknown as TriageResultDto;

    const byStage = new Map<StageBreakdown['stage'], StageBreakdown>([
      ['triage', stage('triage', { usd: 0.03, tokens: 320, label: 'estimated' })],
    ]);

    const cards = buildOverviewWorkflowSummary({
      item: makeItem(),
      events: [],
      triage,
      costs: costs({ byStage }),
    });

    expect(cards[0]).toMatchObject({
      key: 'triage',
      status: 'Complete',
      statusTone: 'success',
      footer: { usd: 0.03, tokens: 320, label: 'estimated' },
    });
    expect(cards[0].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Priority', value: 'High' },
        { label: 'Type', value: 'Feature' },
        { label: 'Repo', value: 'goose-hub/web' },
        { label: 'Confidence', value: '82%' },
        { label: 'Candidates', value: '2' },
        { label: 'Override', value: 'Yes' },
      ]),
    );
  });

  it('keeps discover stages active when events exist and splits grill/prd skill costs', () => {
    const item = makeItem({ type: 'feature', state: 'factory:writing-prd' });
    const events = [
      makeEvent(1, 'grill.question-posted'),
      makeEvent(2, 'grill.question-posted'),
      makeEvent(3, 'grill.completed', { rounds: 2, forced: true }),
      makeEvent(
        4,
        'prd.drafted',
        {
          prd: {
            complexity: 'L',
            acceptanceCriteria: [{ id: 'AC-1' }, { id: 'AC-2' }],
            journeys: [{ id: 'J-1' }],
            verticalSlices: [
              { title: 'Slice 1' },
              { title: 'Slice 2' },
              { title: 'Slice 3' },
            ],
          },
          advisorConcerns: ['Concern 1', 'Concern 2'],
        },
      ),
    ];

    const bySkill = new Map<string, StageBreakdown>([
      ['grill-me', stage('discover', { usd: 0.04, tokens: 420 })],
      ['write-prd', stage('discover', { usd: 0.09, tokens: 910, label: 'estimated' })],
    ]);

    const cards = buildOverviewWorkflowSummary({
      item,
      events,
      costs: costs({ bySkill }),
    });

    expect(cards[2]).toMatchObject({
      key: 'grill',
      status: 'Forced',
      statusTone: 'warning',
      footer: { usd: 0.04, tokens: 420, label: 'exact' },
    });
    expect(cards[2].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Questions', value: '2' },
        { label: 'Rounds', value: '2' },
        { label: 'Forced', value: 'Yes' },
      ]),
    );

    expect(cards[3]).toMatchObject({
      key: 'prd',
      status: 'Drafting',
      statusTone: 'active',
      footer: { usd: 0.09, tokens: 910, label: 'estimated' },
    });
    expect(cards[3].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Complexity', value: 'L' },
        { label: 'ACs', value: '2' },
        { label: 'Journeys', value: '1' },
        { label: 'Slices', value: '3' },
        { label: 'Advisor', value: '2' },
      ]),
    );
  });

  it('uses the latest investigation and review events and groups review severities', () => {
    const events = [
      makeEvent(1, 'agent.investigation-complete', {
        investigate: {
          confidence: 'low',
          keyFiles: ['a.ts'],
          openQuestions: ['q'],
          findings: 'old',
        },
      }),
      makeEvent(2, 'agent.tool-call', { tool_name: 'Read' }),
      makeEvent(3, 'agent.tool-call', { tool_name: 'Grep' }),
      makeEvent(4, 'agent.investigation-complete', {
        investigate: {
          confidence: 'high',
          keyFiles: ['a.ts', 'b.ts', 'c.ts'],
          openQuestions: ['q1', 'q2'],
          reproduction: { status: 'reproduced' },
        },
      }),
      makeEvent(5, 'review.completed', {
        verdict: 'approved',
        confidence: 0.93,
        criteriaChecks: [
          { criterion: 'AC-1', status: 'met' },
          { criterion: 'AC-2', status: 'met' },
          { criterion: 'AC-3', status: 'unmet' },
        ],
        findings: [
          { severity: 'blocker', description: 'A' },
          { severity: 'major', description: 'B' },
          { severity: 'major', description: 'C' },
          { severity: 'minor', description: 'D' },
        ],
        pr: { status: 'merged' },
      }),
    ];

    const byStage = new Map<StageBreakdown['stage'], StageBreakdown>([
      ['investigate', stage('investigate', { usd: 0.11, tokens: 1100 })],
      ['review', stage('review', { usd: 0.08, tokens: 800 })],
    ]);

    const cards = buildOverviewWorkflowSummary({
      item: makeItem(),
      events,
      costs: costs({ byStage }),
    });

    expect(cards[1]).toMatchObject({
      key: 'investigation',
      status: 'High confidence',
      statusTone: 'success',
      footer: { usd: 0.11, tokens: 1100, label: 'exact' },
    });
    expect(cards[1].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Confidence', value: 'High' },
        { label: 'Key files', value: '3' },
        { label: 'Questions', value: '2' },
        { label: 'Reads', value: '1' },
        { label: 'Searches', value: '1' },
        { label: 'Repro', value: 'Reproduced' },
      ]),
    );

    expect(cards[4]).toMatchObject({
      key: 'review',
      status: 'Approved',
      statusTone: 'success',
      footer: { usd: 0.08, tokens: 800, label: 'exact' },
    });
    expect(cards[4].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Verdict', value: 'Approved' },
        { label: 'Confidence', value: '93%' },
        { label: 'Criteria', value: '2/3' },
        { label: 'Blockers', value: '1' },
        { label: 'Majors', value: '2' },
        { label: 'Minors', value: '1' },
        { label: 'PR', value: 'Merged' },
      ]),
    );
  });

  it('distinguishes light and deep retrospectives', () => {
    const byStage = new Map<StageBreakdown['stage'], StageBreakdown>([
      ['retrospective', stage('retrospective', { usd: 0.02, tokens: 220 })],
    ]);

    const light = buildOverviewWorkflowSummary({
      item: makeItem(),
      events: [
        makeEvent(1, 'retrospective.completed', {
          tier: 'light',
          outcome: 'partial',
          improvementCandidates: [{ confidence: 'high' }, { confidence: 'low' }],
        }),
      ],
      costs: costs({ byStage }),
    });

    expect(light[5]).toMatchObject({ status: 'Partial', statusTone: 'warning' });
    expect(light[5].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Tier', value: 'Light' },
        { label: 'Candidates', value: '2' },
        { label: 'High conf', value: '1' },
      ]),
    );
    expect(light[5].metrics.map((metric) => metric.label)).not.toContain('Quality');

    const deep = buildOverviewWorkflowSummary({
      item: makeItem(),
      events: [
        makeEvent(2, 'retrospective.completed', {
          tier: 'deep',
          outcome: 'success',
          improvementCandidates: [{ confidence: 'high' }, { confidence: 'high' }],
          quality: 0.91,
          patterns: ['p1', 'p2', 'p3'],
          learnings: ['l1'],
        }),
      ],
      costs: costs({ byStage }),
    });

    expect(deep[5]).toMatchObject({ status: 'Success', statusTone: 'success' });
    expect(deep[5].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Quality', value: '91%' },
        { label: 'Patterns', value: '3' },
        { label: 'Learnings', value: '1' },
      ]),
    );
  });
});
