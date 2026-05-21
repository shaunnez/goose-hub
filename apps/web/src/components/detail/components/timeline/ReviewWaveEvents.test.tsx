import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';
import { ReviewWaveCompletedEvent, ReviewWaveFailedEvent } from './ReviewWaveEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown = {}): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-21T01:54:44Z',
    workItemId: 'github:shaunnez/goose-hub#800',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('ReviewWaveEvents', () => {
  it('renders review.wave-completed as a compact status card', () => {
    render(
      <ul>
        <ReviewWaveCompletedEvent
          event={makeEvent('review.wave-completed', {
            round: 1,
            roundFindingsCount: 1,
            newCriticalCount: 0,
            anyNeedsHuman: false,
            anyNeedsFix: true,
          })}
        />
      </ul>,
    );

    expect(screen.getByText('Review wave completed')).toBeTruthy();
    expect(screen.getByText('round 1')).toBeTruthy();
    expect(screen.getByText('Findings')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('New critical')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('needs-fix')).toBeTruthy();
    expect(screen.queryByText(/roundFindingsCount/)).toBeNull();
  });

  it('renders review.wave-failed without dumping the raw JSON payload', () => {
    const error =
      'Codex reported an error: {\n  "type": "error",\n  "error": {\n    "type": "invalid_request_error",\n    "code": "invalid_json_schema",\n    "message": "Invalid schema for response_format \'codex_output_schema\': schema must be a JSON Schema of \'type: \\"object\\"\', got \'type: \\"None\\"\'.",\n    "param": "text.format.schema"\n  },\n  "status": 400\n}; Codex reported an error: duplicate';

    render(
      <ul>
        <ReviewWaveFailedEvent event={makeEvent('review.wave-failed', { round: 1, error })} />
      </ul>,
    );

    expect(screen.getByText('Review wave failed')).toBeTruthy();
    expect(screen.getByText('round 1')).toBeTruthy();
    expect(screen.getByText(/Invalid schema for response_format/)).toBeTruthy();
    expect(screen.getByText(/type: "object"/)).toBeTruthy();
    expect(screen.getByText(/type: "None"/)).toBeTruthy();
    expect(screen.queryByText(/"round"/)).toBeNull();
    expect(screen.queryByText(/duplicate/)).toBeNull();
  });

  it('routes review.wave-failed through the custom timeline renderer', () => {
    render(
      <ul>
        {renderTimelineItem(
          {
            kind: 'event',
            event: makeEvent('review.wave-failed', {
              round: 2,
              error: 'reviewer parse failure',
            }),
          },
          0,
        )}
      </ul>,
    );

    expect(screen.getByText('Review wave failed')).toBeTruthy();
    expect(screen.getByText('round 2')).toBeTruthy();
    expect(screen.getByText('reviewer parse failure')).toBeTruthy();
  });

  it.each([
    [
      'review.wave-completed',
      {
        round: 2,
        roundFindingsCount: 0,
        newCriticalCount: 0,
        anyNeedsHuman: false,
        anyNeedsFix: false,
      },
      'Review wave completed',
      'clear',
    ],
    ['review.converged', { totalRounds: 3 }, 'Review converged', 'Converged after 3 round(s).'],
    [
      'review.escalated',
      {
        reason: 'cap-with-new-critical',
        round: 3,
        unconvergedFindingsCount: 2,
      },
      'Review escalated',
      'cap-with-new-critical',
    ],
  ])('routes %s through a custom timeline renderer', (kind, payload, title, detail) => {
    render(
      <ul>
        {renderTimelineItem(
          {
            kind: 'event',
            event: makeEvent(kind, payload),
          },
          0,
        )}
      </ul>,
    );

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
  });
});
