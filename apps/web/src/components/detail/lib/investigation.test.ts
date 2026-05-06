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
