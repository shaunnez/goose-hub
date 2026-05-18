import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightCaptureSection } from './PlaywrightCaptureSection';

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(fetchEvents).mockReset();
});

function renderSection(events: AgentEventDto[]) {
  vi.mocked(fetchEvents).mockResolvedValue(events);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlaywrightCaptureSection projectSlug="goose-hub-self" id="42" itemType="bug" />
    </QueryClientProvider>,
  );
}

function makeInvestigationEvent(playwrightRepro: unknown): AgentEventDto {
  return {
    id: 1,
    projectId: 'goose-hub-self',
    workItemId: 'github:shaunnez/goose-hub#42',
    kind: 'agent.investigation-complete',
    payload: { investigate: {}, playwrightRepro },
    createdAt: '2026-05-18T00:00:00Z',
  } as AgentEventDto;
}

describe('PlaywrightCaptureSection', () => {
  it('renders console, assertion, and runner errors in separate sections', async () => {
    renderSection([
      makeInvestigationEvent({
        screenshots: [],
        gifPath: null,
        consoleErrors: [{ message: 'TypeError: browser boom', type: 'error' }],
        testErrors: ['REPRO_EXPECTED_BUG: expected banner missing'],
        runnerErrors: ['Error: No tests found.'],
        reproSteps: [],
        reproduced: false,
      }),
    ]);

    expect(await screen.findByText('Console Errors')).toBeTruthy();
    expect(screen.getByText('Repro Assertion')).toBeTruthy();
    expect(screen.getByText('Runner Error')).toBeTruthy();

    const consoleSection = screen.getByTestId('playwright-capture-console-errors');
    expect(within(consoleSection).getByText('TypeError: browser boom')).toBeTruthy();
    expect(
      within(consoleSection).queryByText('REPRO_EXPECTED_BUG: expected banner missing'),
    ).toBeNull();
    expect(within(consoleSection).queryByText('Error: No tests found.')).toBeNull();
  });
});
