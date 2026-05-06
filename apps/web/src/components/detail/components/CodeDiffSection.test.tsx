/** @vitest-environment jsdom */
import { fetchIssueDiff } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeDiffSection } from './CodeDiffSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchIssueDiff: vi.fn(),
  fetchEvents: vi.fn().mockResolvedValue([]),
  fetchPersonaNames: vi.fn().mockResolvedValue([]),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

describe('CodeDiffSection (#185)', () => {
  it('shows the empty state when no worktree is available', async () => {
    vi.mocked(fetchIssueDiff).mockResolvedValueOnce({
      diff: null,
      runId: null,
      reason: 'no in-flight run for this issue',
    });
    render_(<CodeDiffSection projectSlug="proj" id="42" />);
    await waitFor(() => {
      const el = screen.getByTestId('code-diff-empty');
      expect(el.textContent ?? '').toContain('no in-flight run');
    });
  });

  it('renders the diff with line-prefix colouring for added/removed/hunk lines', async () => {
    vi.mocked(fetchIssueDiff).mockResolvedValueOnce({
      diff: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line',
      runId: 'run-abc12345',
    });
    render_(<CodeDiffSection projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-diff-pre')).toBeTruthy();
    });
    const pre = screen.getByTestId('code-diff-pre');
    // New design: lines are in separate columns — content without +/- prefix
    expect(pre.textContent).toContain('new line');
    expect(pre.textContent).toContain('old line');
    // Hunk header is shown in the diff viewer
    expect(pre.textContent).toContain('@@ -1,2 +1,2 @@');
    // The runId is shown truncated to 8 chars in the header.
    expect(screen.getByText(/run:run-abc1/)).toBeTruthy();
  });

  it('shows the empty state for an empty-string diff', async () => {
    vi.mocked(fetchIssueDiff).mockResolvedValueOnce({
      diff: '',
      runId: 'run-1',
    });
    render_(<CodeDiffSection projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-diff-empty')).toBeTruthy();
    });
  });
});
