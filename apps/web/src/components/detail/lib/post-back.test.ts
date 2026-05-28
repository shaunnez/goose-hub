import type { AgentEventDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { latestInvestigationText } from './post-back';

function event(kind: string, payload: unknown, id: number): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'local:proj#1',
    kind,
    payload,
    createdAt: '2026-05-28T00:00:00.000Z',
  };
}

describe('latestInvestigationText', () => {
  it('uses findings from the latest investigation event', () => {
    expect(
      latestInvestigationText([
        event('agent.investigation-complete', { investigate: { findings: 'old' } }, 1),
        event('agent.investigation-complete', { investigate: { findings: '  current  ' } }, 2),
      ]),
    ).toBe('current');
  });

  it('does not use the Work Item brief as fallback investigation text', () => {
    expect(
      latestInvestigationText([
        event('agent.run-completed', { result: 'brief/body text is not an investigation' }, 1),
      ]),
    ).toBeUndefined();
  });
});
