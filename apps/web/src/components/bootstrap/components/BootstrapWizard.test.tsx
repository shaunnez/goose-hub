/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapWizard } from './BootstrapWizard';

// API is mocked at the module level; each test injects fresh mock impls.
vi.mock('@/lib/api', () => ({
  previewBootstrap: vi.fn(),
  runBootstrap: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FIXTURE_PREVIEW = {
  slug: 'widgets',
  name: 'widgets',
  defaultBranch: 'main',
  repos: [
    {
      repoRef: 'octo/widgets',
      defaultBranch: 'main',
      description: 'Widgets',
      stackSummary: 'node (pnpm) — scripts: build, test',
      auditAction: 'create' as const,
      auditPath: 'CLAUDE.md',
    },
  ],
  stack: { type: 'node', summary: 'node (pnpm) — scripts: build, test', raw: {} },
  audit: {
    action: 'create' as const,
    content: '# CLAUDE.md\n\n## What this repo is\n\n…\n',
    rationale: 'No CLAUDE.md found.',
  },
  labelsToInstall: [
    { name: 'factory:done', color: 'd1d5db', description: 'Done' },
    { name: 'factory:in-progress', color: '1d76db', description: 'In progress' },
  ],
};

const FIXTURE_RESULT = {
  status: 'created' as const,
  registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/123',
  slug: 'widgets',
  stackSummary: 'node (pnpm)',
  auditAction: 'create' as const,
  labelCounts: { created: 5, updated: 0, skipped: 23 },
};

function renderWizard(open = true) {
  const onClose = vi.fn();
  render(<BootstrapWizard open={open} onClose={onClose} />);
  return { onClose };
}

describe('BootstrapWizard', () => {
  it('does not render when open=false', () => {
    renderWizard(false);
    expect(screen.queryByTestId('bootstrap-wizard')).toBeNull();
  });

  it('starts on the repo step', () => {
    renderWizard();
    expect(screen.getByTestId('step-repo')).toBeTruthy();
    expect(screen.getByTestId('bootstrap-repo-input')).toBeTruthy();
  });

  it('disables the Next button when the repo ref is invalid', async () => {
    const user = userEvent.setup();
    renderWizard();
    const next = screen.getByTestId('wizard-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    const input = screen.getByTestId('bootstrap-repo-input');
    await user.type(input, 'not-a-valid-ref');
    expect((screen.getByTestId('wizard-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks all five preview steps and shows the PR URL on completion', async () => {
    const { previewBootstrap, runBootstrap } = await import('@/lib/api');
    vi.mocked(previewBootstrap).mockResolvedValue(FIXTURE_PREVIEW);
    vi.mocked(runBootstrap).mockResolvedValue(FIXTURE_RESULT);

    const user = userEvent.setup();
    renderWizard();

    // Step 1 — enter repo + click Next.
    await user.type(screen.getByTestId('bootstrap-repo-input'), 'octo/widgets');
    await user.click(screen.getByTestId('wizard-next'));

    // Step 2 — stack summary.
    await waitFor(() => expect(screen.getByTestId('step-stack')).toBeTruthy());
    expect(screen.getByTestId('stack-summary').textContent).toContain('node');
    await user.click(screen.getByTestId('wizard-next'));

    // Step 3 — CLAUDE.md preview.
    await waitFor(() => expect(screen.getByTestId('step-claudemd')).toBeTruthy());
    expect((screen.getByTestId('claudemd-preview') as HTMLTextAreaElement).value).toContain(
      'CLAUDE.md',
    );
    await user.click(screen.getByTestId('wizard-next'));

    // Step 4 — label install confirmation.
    await waitFor(() => expect(screen.getByTestId('step-labels')).toBeTruthy());
    expect(screen.getAllByTestId('labels-list-item').length).toBe(2);
    await user.click(screen.getByTestId('wizard-next'));

    // Step 5 — webhook setup.
    await waitFor(() => expect(screen.getByTestId('step-webhook')).toBeTruthy());
    // Must match the actual server route in apps/server/src/server.ts (`/webhooks/github`),
    // not the singular `/webhook/github` that previously shipped here.
    expect(screen.getByTestId('webhook-payload-url').textContent).toContain('/webhooks/github');
    await user.click(screen.getByTestId('wizard-next'));

    // Final step — Open PR + result render.
    await waitFor(() => expect(screen.getByTestId('step-submit')).toBeTruthy());
    await user.click(screen.getByTestId('bootstrap-submit'));
    await waitFor(() => expect(screen.getByTestId('bootstrap-result')).toBeTruthy());
    const link = screen.getByTestId('bootstrap-pr-link') as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/shaunnez/goose-hub/pull/123');
    expect(runBootstrap).toHaveBeenCalledWith({
      repoRefs: ['octo/widgets'],
      name: undefined,
      slug: 'widgets',
    });
  });

  it('shows update-mode CLAUDE.md as a diff when audit.action="update"', async () => {
    const { previewBootstrap } = await import('@/lib/api');
    vi.mocked(previewBootstrap).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      audit: {
        action: 'update',
        content: '--- existing\n+++ proposed\n+## Hard rules\n+...',
        rationale: 'Existing CLAUDE.md missing required sections.',
      },
    });

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-repo-input'), 'octo/widgets');
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-stack')).toBeTruthy());
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-claudemd')).toBeTruthy());
    expect(screen.getByText(/diff \(update\)/i)).toBeTruthy();
    expect((screen.getByTestId('claudemd-preview') as HTMLTextAreaElement).value).toContain(
      '+## Hard rules',
    );
  });

  it('hides the textarea when audit.action="ok"', async () => {
    const { previewBootstrap } = await import('@/lib/api');
    vi.mocked(previewBootstrap).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      audit: { action: 'ok', content: '', rationale: 'Already complete.' },
    });

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-repo-input'), 'octo/widgets');
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-stack')).toBeTruthy());
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('claudemd-ok')).toBeTruthy());
    expect(screen.queryByTestId('claudemd-preview')).toBeNull();
  });

  it('surfaces preview errors in a banner', async () => {
    const { previewBootstrap } = await import('@/lib/api');
    vi.mocked(previewBootstrap).mockRejectedValue(new Error('repo not found'));

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-repo-input'), 'octo/missing');
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('wizard-error')).toBeTruthy());
    expect(screen.getByTestId('wizard-error').textContent).toContain('repo not found');
    // We stayed on the repo step.
    expect(screen.getByTestId('step-repo')).toBeTruthy();
  });

  it('lets the user step backwards', async () => {
    const { previewBootstrap } = await import('@/lib/api');
    vi.mocked(previewBootstrap).mockResolvedValue(FIXTURE_PREVIEW);

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-repo-input'), 'octo/widgets');
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-stack')).toBeTruthy());
    await user.click(screen.getByTestId('wizard-prev'));
    await waitFor(() => expect(screen.getByTestId('step-repo')).toBeTruthy());
  });
});
