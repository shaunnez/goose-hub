/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningLoopPanel } from './LearningLoopPanel';

const { mockFetchLearningLoopSettings, mockPatchLearningLoopSettings } = vi.hoisted(() => ({
  mockFetchLearningLoopSettings: vi.fn(),
  mockPatchLearningLoopSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({
  fetchLearningLoopSettings: mockFetchLearningLoopSettings,
  patchLearningLoopSettings: mockPatchLearningLoopSettings,
}));

afterEach(() => cleanup());

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LearningLoopPanel slug="goose-hub-self" />
    </QueryClientProvider>,
  );
}

describe('LearningLoopPanel', () => {
  afterEach(() => {
    mockFetchLearningLoopSettings.mockReset();
    mockPatchLearningLoopSettings.mockClear();
  });

  it('renders coach policy and patches toggle/numeric controls', async () => {
    mockFetchLearningLoopSettings.mockResolvedValue({
      projectId: 'goose-hub-self',
      coachPolicy: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
      configDefaults: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
      dbOverrides: null,
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('Skill-Coach Auto-Dispatch')).toBeTruthy());

    fireEvent.click(screen.getByTestId('coach-policy-enabled-toggle'));
    await waitFor(() =>
      expect(mockPatchLearningLoopSettings).toHaveBeenCalledWith('goose-hub-self', {
        enabled: true,
      }),
    );

    fireEvent.change(screen.getByTestId('coach-policy-min-lifecycles-input'), {
      target: { value: '5' },
    });
    fireEvent.blur(screen.getByTestId('coach-policy-min-lifecycles-input'));
    await waitFor(() =>
      expect(mockPatchLearningLoopSettings).toHaveBeenCalledWith('goose-hub-self', {
        minLifecycles: 5,
      }),
    );

    fireEvent.change(screen.getByTestId('coach-policy-consistency-threshold-input'), {
      target: { value: '0.9' },
    });
    fireEvent.blur(screen.getByTestId('coach-policy-consistency-threshold-input'));
    await waitFor(() =>
      expect(mockPatchLearningLoopSettings).toHaveBeenCalledWith('goose-hub-self', {
        consistencyThreshold: 0.9,
      }),
    );
  });

  it('skips unchanged numeric blur and can reset overrides to config defaults', async () => {
    mockFetchLearningLoopSettings.mockResolvedValue({
      projectId: 'goose-hub-self',
      coachPolicy: { enabled: true, consistencyThreshold: 0.8, minLifecycles: 3 },
      configDefaults: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
      dbOverrides: {
        enabled: true,
        consistencyThreshold: 0.8,
        minLifecycles: 3,
        updatedAt: '2026-05-20T00:00:00Z',
        updatedBy: 'ui',
      },
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('Skill-Coach Auto-Dispatch')).toBeTruthy());

    fireEvent.blur(screen.getByTestId('coach-policy-min-lifecycles-input'));
    expect(mockPatchLearningLoopSettings).not.toHaveBeenCalled();

    const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
    fireEvent.click(resetButtons[0]);
    await waitFor(() =>
      expect(mockPatchLearningLoopSettings).toHaveBeenCalledWith('goose-hub-self', {
        enabled: null,
      }),
    );

    fireEvent.click(resetButtons[1]);
    await waitFor(() =>
      expect(mockPatchLearningLoopSettings).toHaveBeenCalledWith('goose-hub-self', {
        minLifecycles: null,
      }),
    );
  });
});
