import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_COLOR,
  CONFIDENCE_NUM,
  READ_TOOLS,
  SEARCH_TOOLS,
  SEV_LABEL,
  SEV_VAR,
  countToolCalls,
  decisionLabel,
  extractInvestigationPayload,
  latestInvestigationEvent,
} from './investigation';
import { buildWorkflowSnapshotCards } from './sections';

function event(partial: Partial<AgentEventDto>): AgentEventDto {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'wi-1',
    runId: null,
    personaId: null,
    kind: 'agent.tool-call',
    payload: {},
    createdAt: new Date().toISOString(),
    ...partial,
  } as AgentEventDto;
}

describe('decisionLabel', () => {
  it('returns kind when present', () => {
    expect(decisionLabel({ kind: 'PLAN', summary: 's' })).toBe('PLAN');
  });

  it('falls back to step when only step is set (legacy pre-#466)', () => {
    expect(decisionLabel({ step: 'INVESTIGATE', summary: 's' })).toBe('INVESTIGATE');
  });

  it('returns empty string when neither kind nor step is set', () => {
    expect(decisionLabel({ summary: 's' })).toBe('');
  });

  it('prefers kind over step when both are set', () => {
    expect(decisionLabel({ kind: 'A', step: 'B', summary: 's' })).toBe('A');
  });
});

describe('extractInvestigationPayload', () => {
  it('returns null when payload is null', () => {
    expect(extractInvestigationPayload(event({ payload: null }))).toBeNull();
  });

  it('returns null when "investigate" key is missing', () => {
    expect(extractInvestigationPayload(event({ payload: { other: true } }))).toBeNull();
  });

  it('returns the payload when "investigate" key is present', () => {
    const investigate = {
      findings: 'x',
      keyFiles: [],
      confidence: 'high' as const,
      openQuestions: [],
      decisionSummaries: [],
    };
    const result = extractInvestigationPayload(event({ payload: { investigate } }));
    expect(result).toEqual({ investigate });
  });
});

describe('countToolCalls', () => {
  it('counts only events whose kind is agent.tool-call', () => {
    const events: AgentEventDto[] = [
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Read' } }),
      event({ kind: 'agent.run-started', payload: { tool_name: 'Read' } }),
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Read' } }),
    ];
    expect(countToolCalls(events, READ_TOOLS)).toBe(2);
  });

  it('ignores tool-call events whose tool_name is not in the supplied set', () => {
    const events: AgentEventDto[] = [
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Bash' } }),
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Grep' } }),
    ];
    expect(countToolCalls(events, READ_TOOLS)).toBe(0);
    expect(countToolCalls(events, SEARCH_TOOLS)).toBe(1);
  });

  it('ignores tool-call events with no tool_name', () => {
    const events: AgentEventDto[] = [
      event({ kind: 'agent.tool-call', payload: {} }),
      event({ kind: 'agent.tool-call', payload: null }),
    ];
    expect(countToolCalls(events, READ_TOOLS)).toBe(0);
  });

  it('counts Codex Bash file-reading commands as reads', () => {
    const events: AgentEventDto[] = [
      event({
        payload: {
          tool_name: 'Bash',
          tool_input: { command: '/bin/zsh -lc "nl -ba src/App.tsx | sed -n \'1,80p\'"' },
        },
      }),
      event({
        payload: {
          tool_name: 'Bash',
          tool_input: { command: 'cat apps/web/src/components/chrome/Sidebar.tsx' },
        },
      }),
    ];

    expect(countToolCalls(events, READ_TOOLS)).toBe(2);
    expect(countToolCalls(events, SEARCH_TOOLS)).toBe(0);
  });

  it('counts Codex Bash search commands as searches', () => {
    const events: AgentEventDto[] = [
      event({
        payload: {
          tool_name: 'Bash',
          tool_input: { command: 'rg -n "GOOSEHUB|Goose Hub" apps/web/src' },
        },
      }),
      event({
        payload: {
          tool_name: 'Bash',
          tool_input: { command: 'find apps/web/src/components -maxdepth 2 -type f' },
        },
      }),
    ];

    expect(countToolCalls(events, READ_TOOLS)).toBe(0);
    expect(countToolCalls(events, SEARCH_TOOLS)).toBe(2);
  });

  it('does not count arbitrary Bash commands as reads or searches', () => {
    const events: AgentEventDto[] = [
      event({ payload: { tool_name: 'Bash', tool_input: { command: 'pnpm test' } } }),
      event({ payload: { tool_name: 'Bash', tool_input: { command: 'git status --short' } } }),
    ];

    expect(countToolCalls(events, READ_TOOLS)).toBe(0);
    expect(countToolCalls(events, SEARCH_TOOLS)).toBe(0);
  });
});

describe('latestInvestigationEvent', () => {
  it('returns null when no investigation events exist', () => {
    expect(latestInvestigationEvent([event({ kind: 'agent.tool-call' })])).toBeNull();
  });

  it('selects the newest investigation by id regardless of input order', () => {
    const older = event({
      id: 10,
      kind: 'agent.investigation-complete',
      runId: 'older-run',
      createdAt: '2026-05-18T01:00:00Z',
    });
    const newer = event({
      id: 20,
      kind: 'agent.investigation-complete',
      runId: 'newer-run',
      createdAt: '2026-05-18T02:00:00Z',
    });

    expect(latestInvestigationEvent([newer, older])).toBe(newer);
    expect(latestInvestigationEvent([older, newer])).toBe(newer);
  });
});

describe('investigation constants', () => {
  it('exposes confidence colour, number, and severity maps for high/medium/low', () => {
    for (const k of ['high', 'medium', 'low'] as const) {
      expect(CONFIDENCE_COLOR[k]).toBeDefined();
      expect(typeof CONFIDENCE_NUM[k]).toBe('number');
      expect(SEV_VAR[k]).toMatch(/^var\(--/);
      expect(SEV_LABEL[k]).toBeDefined();
    }
    expect(CONFIDENCE_NUM.high).toBeGreaterThan(CONFIDENCE_NUM.medium);
    expect(CONFIDENCE_NUM.medium).toBeGreaterThan(CONFIDENCE_NUM.low);
  });
});

describe('buildWorkflowSnapshotCards', () => {
  it('returns stable muted fallbacks for sparse inputs', () => {
    const cards = buildWorkflowSnapshotCards({});

    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.label)).toEqual([
      'Triage',
      'Investigation',
      'Grill',
      'PRD',
      'Review',
      'Retro',
    ]);
    expect(cards.map((card) => card.value)).toEqual([
      'Not run',
      'Not run',
      'N/A',
      'N/A',
      'Not run',
      'Not run',
    ]);
    expect(cards.every((card) => typeof card.sub === 'string')).toBe(true);
  });

  it('prefers canonical triage fields when available', () => {
    const cards = buildWorkflowSnapshotCards({
      item: {
        priority: 'medium',
        type: 'bug',
        repoRef: 'repo-from-item',
      },
      triage: {
        priority: 'high',
        type: 'discover',
        overrideRepo: 'repo-from-override',
        candidates: [
          { repo: 'repo-a', confidence: 0.91, evidence: 'strong match', tier: 1 },
          { repo: 'repo-b', confidence: 0.44, evidence: 'weak match', tier: 2 },
        ],
      },
    });

    expect(cards[0]).toMatchObject({
      key: 'triage',
      value: 'High priority',
      tone: 'default',
    });
    expect(cards[0].sub).toContain('Discover');
    expect(cards[0].sub).toContain('repo-from-override');
    expect(cards[0].sub).toContain('91% confidence');
    expect(cards[0].sub).toContain('2 candidates');
    expect(cards[0].sub).toContain('Override');
  });

  it('renders discover-lane grill and PRD fallbacks consistently', () => {
    const discoverCards = buildWorkflowSnapshotCards({
      item: {
        mode: 'discover',
        state: 'factory:grilling',
      },
    });

    expect(discoverCards[2]).toMatchObject({ key: 'grill', value: 'Not run', tone: 'muted' });
    expect(discoverCards[3]).toMatchObject({ key: 'prd', value: 'Not run', tone: 'muted' });

    const nonDiscoverCards = buildWorkflowSnapshotCards({
      item: {
        mode: 'execute',
        state: 'factory:in-progress',
      },
    });

    expect(nonDiscoverCards[2]).toMatchObject({ key: 'grill', value: 'N/A', tone: 'muted' });
    expect(nonDiscoverCards[3]).toMatchObject({ key: 'prd', value: 'N/A', tone: 'muted' });
  });

  it('prefers canonical PRD counts and state-aware status', () => {
    const cards = buildWorkflowSnapshotCards({
      item: {
        mode: 'discover',
        state: 'factory:prd-review',
      },
      prd: {
        prd: {
          estimatedComplexity: 'high',
          acceptanceCriteria: [
            { id: 'AC1', statement: 'One' },
            { id: 'AC2', statement: 'Two' },
          ],
          journeys: [
            {
              id: 'J1',
              persona: 'Owner',
              trigger: 'Open',
              steps: [],
              successState: '',
              errorStates: [],
              edgeCases: [],
            },
          ],
          verticalSlices: [
            { title: 'Slice A', goal: 'A', estimatedSize: 'S', journeyRefs: ['J1'] },
            { title: 'Slice B', goal: 'B', estimatedSize: 'M', journeyRefs: ['J1'] },
          ],
        },
        advisorConcerns: '- Concern one\n- Concern two',
        source: 'event',
        createdAt: '2026-05-22T00:00:00Z',
        runId: 'run-1',
      },
    });

    expect(cards[3]).toMatchObject({
      key: 'prd',
      value: 'In review',
      tone: 'warning',
    });
    expect(cards[3].sub).toContain('High complexity');
    expect(cards[3].sub).toContain('2 AC');
    expect(cards[3].sub).toContain('1 journey');
    expect(cards[3].sub).toContain('2 slices');
    expect(cards[3].sub).toContain('2 concerns');
  });

  it('summarizes latest review event severity counts', () => {
    const cards = buildWorkflowSnapshotCards({
      events: [
        event({
          id: 10,
          kind: 'agent.review-complete',
          payload: { verdict: 'approved', confidence: 0.8, criteriaChecks: [], findings: [] },
        }),
        event({
          id: 11,
          kind: 'agent.review-complete',
          payload: {
            verdict: 'needs-fix',
            confidence: 0.72,
            criteriaChecks: [],
            findings: [
              { severity: 'blocker', description: 'A' },
              { severity: 'major', description: 'B' },
              { severity: 'major', description: 'C' },
              { severity: 'minor', description: 'D' },
            ],
          },
        }),
      ],
    });

    expect(cards[4]).toMatchObject({
      key: 'review',
      value: 'Needs fix',
      tone: 'danger',
    });
    expect(cards[4].sub).toContain('1 blocker');
    expect(cards[4].sub).toContain('2 major');
    expect(cards[4].sub).toContain('1 minor');
  });

  it('distinguishes light and deep retro payloads from the latest event', () => {
    const lightCards = buildWorkflowSnapshotCards({
      events: [
        event({
          id: 20,
          kind: 'agent.retrospective-complete',
          payload: {
            tier: 'light',
            output: {
              outcome: 'success',
              workItemNumber: 1,
              summary: {
                wentWell: 'A',
                didNotGoWell: 'B',
                architecturalTakeaway: 'C',
              },
              improvementCandidates: [
                {
                  kind: 'workflow',
                  targetPath: 'docs/x',
                  suggestionText: 'Do x',
                  confidence: 'high',
                },
              ],
              decisionSummaries: [],
            },
          },
        }),
      ],
    });

    expect(lightCards[5]).toMatchObject({
      key: 'retro',
      value: 'Light retro',
      tone: 'default',
    });
    expect(lightCards[5].sub).toContain('Success');
    expect(lightCards[5].sub).toContain('1 improvement');

    const deepCards = buildWorkflowSnapshotCards({
      events: [
        event({
          id: 21,
          kind: 'agent.retro-complete',
          payload: {
            retrospective: {
              tier: 'deep',
              output: {
                outcome: 'partial',
                workItemNumber: 1,
                summary: {
                  wentWell: 'A',
                  didNotGoWell: 'B',
                  architecturalTakeaway: 'C',
                },
                improvementCandidates: [],
                decisionSummaries: [],
                triggerReasons: ['Needs escalation'],
                personaQualityScores: [],
                learningEntries: [
                  {
                    observation: 'O',
                    rationale: 'R',
                    improvementKind: 'workflow',
                    confidence: 'medium',
                  },
                ],
                decisionPatterns: [{ pattern: 'P', occurrences: 2, confidence: 'medium' }],
              },
            },
          },
        }),
      ],
    });

    expect(deepCards[5]).toMatchObject({
      key: 'retro',
      value: 'Deep retro',
      tone: 'default',
    });
    expect(deepCards[5].sub).toContain('Partial');
    expect(deepCards[5].sub).toContain('1 learning');
    expect(deepCards[5].sub).toContain('1 pattern');
  });
});
