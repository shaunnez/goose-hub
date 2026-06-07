import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderTimelineItem } from '../TimelineEvents';

function event(payload: AgentEventDto['payload']): AgentEventDto {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'item',
    kind: 'agent.research-complete',
    payload,
    runId: 'run-research:research',
    createdAt: '2026-06-01T12:00:00.000Z',
  };
}

describe('AgentResearchCompleteEvent', () => {
  afterEach(() => cleanup());

  it('renders research artifact counts without falling back to generic JSON', () => {
    const rendered = render(
      <ul>
        {renderTimelineItem(
          {
            kind: 'event',
            event: event({
              research: {
                actionability: 'directly-actionable',
                answer: 'Research found that the workflow can be implemented directly.',
                evidence: [{ file: 'core/workflows/workflow-catalog.ts' }],
                options: [{ title: 'Add workflow' }, { title: 'Leave manual' }],
                followUpWork: [
                  { title: 'Implement research', actionable: true },
                  { title: 'Document later', actionable: false },
                ],
                openQuestions: ['Should scouts fan out independently?'],
              },
            }),
          },
          0,
        )}
      </ul>,
    );

    expect(screen.getByText('Research complete')).toBeTruthy();
    expect(screen.getByText('directly-actionable')).toBeTruthy();
    expect(screen.getByText(/Research found/)).toBeTruthy();
    expect(rendered.container.textContent).toContain('1 evidence');
    expect(rendered.container.textContent).toContain('2 options');
    expect(rendered.container.textContent).toContain('1 actionable follow-up');
    expect(screen.queryByText(/raw/i)).toBeNull();
  });
});
