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
  getInvestigationSummary,
  latestInvestigationEvent,
} from './investigation';

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

describe('getInvestigationSummary', () => {
  it('uses the latest terminal investigation event and derives counts from the full event history', () => {
    const older = event({
      id: 10,
      kind: 'agent.investigation-complete',
      createdAt: '2026-05-18T01:00:00Z',
      payload: {
        investigate: {
          findings: 'older',
          keyFiles: [{ path: 'src/old.ts', reason: 'old' }],
          confidence: 'low',
          openQuestions: ['first'],
          decisionSummaries: [],
          repro: { status: 'not_reproduced' },
        },
      },
    });
    const newer = event({
      id: 11,
      kind: 'agent.investigation-complete',
      createdAt: '2026-05-18T02:00:00Z',
      payload: {
        investigate: {
          findings: 'newer',
          keyFiles: [
            { path: 'src/a.ts', reason: 'a' },
            { path: 'src/b.ts', reason: 'b' },
          ],
          confidence: 'high',
          openQuestions: ['first', 'second'],
          decisionSummaries: [],
          repro: { status: 'reproduced' },
        },
      },
    });

    const summary = getInvestigationSummary([
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Read' } }),
      event({ kind: 'agent.tool-call', payload: { tool_name: 'Grep' } }),
      older,
      newer,
    ]);

    expect(summary).toMatchObject({
      confidence: 'high',
      keyFileCount: 2,
      openQuestionCount: 2,
      readCount: 1,
      searchCount: 1,
      reproStatus: 'reproduced',
    });
    expect(summary?.event).toBe(newer);
  });

  it('handles missing repro and array fields safely', () => {
    const summary = getInvestigationSummary([
      event({
        id: 12,
        kind: 'agent.investigation-complete',
        payload: {
          investigate: {
            findings: 'partial',
            confidence: 'medium',
            decisionSummaries: [],
          },
        },
      }),
    ]);

    expect(summary).toMatchObject({
      confidence: 'medium',
      keyFileCount: 0,
      openQuestionCount: 0,
      readCount: 0,
      searchCount: 0,
      reproStatus: 'unknown',
    });
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
