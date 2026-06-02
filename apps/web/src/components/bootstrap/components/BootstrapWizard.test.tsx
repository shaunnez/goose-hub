/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapWizard } from './BootstrapWizard';

vi.mock('@/lib/api', () => ({
  createLocalProject: vi.fn(),
  previewLocalProjectCreation: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FIXTURE_PREVIEW = {
  slug: 'widgets',
  name: 'widgets',
  configPath: 'target-projects/widgets/project.config.ts',
  config: "source: {\n  kind: 'local-db',\n}",
  requiredEnvVars: [] as string[],
  repositories: [],
  integrations: [] as Array<'github' | 'jira' | 'bitbucket'>,
};

const FIXTURE_RESULT = {
  ...FIXTURE_PREVIEW,
  status: 'created' as const,
  writtenPath: '/repo/target-projects/widgets/project.config.ts',
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

  it('starts on the source step', () => {
    renderWizard();
    expect(screen.getByTestId('step-source')).toBeTruthy();
    expect(screen.getByTestId('bootstrap-mode-local-only')).toBeTruthy();
  });

  it('previews and creates a local-only project', async () => {
    const { createLocalProject, previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockResolvedValue(FIXTURE_PREVIEW);
    vi.mocked(createLocalProject).mockResolvedValue(FIXTURE_RESULT);

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-slug-input'), 'widgets');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() => expect(screen.getByTestId('project-config-preview')).toBeTruthy());
    expect((screen.getByTestId('project-config-preview') as HTMLTextAreaElement).value).toContain(
      "kind: 'local-db'",
    );
    expect(previewLocalProjectCreation).toHaveBeenCalledWith({
      slug: 'widgets',
      name: undefined,
      source: { kind: 'local-only' },
    });

    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-submit')).toBeTruthy());
    await user.click(screen.getByTestId('bootstrap-submit'));
    await waitFor(() => expect(screen.getByTestId('bootstrap-result')).toBeTruthy());
    expect(createLocalProject).toHaveBeenCalledWith({
      slug: 'widgets',
      name: undefined,
      source: { kind: 'local-only' },
    });
  });

  it('previews GitHub code mode with imports left to the server config', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      integrations: ['github'],
      config: 'github: { mirrorLabels: false, importIssues: false }',
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('bootstrap-mode-github-code'));
    await user.type(screen.getByTestId('bootstrap-github-repos-input'), 'octo/widgets');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() => expect(screen.getByTestId('step-preview')).toBeTruthy());
    expect(previewLocalProjectCreation).toHaveBeenCalledWith({
      slug: undefined,
      name: undefined,
      source: { kind: 'github-code', repoRefs: ['octo/widgets'] },
    });
  });

  it('previews Jira manual import mode', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      integrations: ['jira'],
      requiredEnvVars: ['JIRA_EMAIL or ATLASSIAN_EMAIL'],
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('bootstrap-mode-jira'));
    await user.type(screen.getByTestId('bootstrap-jira-base-url-input'), 'https://example.net');
    await user.type(screen.getByTestId('bootstrap-jira-keys-input'), 'ENG');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() =>
      expect(screen.getByTestId('required-env-vars').textContent).toContain('JIRA'),
    );
    expect(previewLocalProjectCreation).toHaveBeenCalledWith({
      slug: undefined,
      name: undefined,
      source: {
        kind: 'jira',
        baseUrl: 'https://example.net',
        projectKeys: ['ENG'],
        importMode: 'manual',
      },
    });
  });

  it('previews Bitbucket PR integration mode', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      integrations: ['bitbucket'],
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('bootstrap-mode-bitbucket'));
    await user.type(screen.getByTestId('bootstrap-bitbucket-workspace-input'), 'acme');
    await user.type(screen.getByTestId('bootstrap-bitbucket-repos-input'), 'api,web');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() => expect(screen.getByTestId('step-preview')).toBeTruthy());
    expect(previewLocalProjectCreation).toHaveBeenCalledWith({
      slug: undefined,
      name: undefined,
      source: { kind: 'bitbucket', workspace: 'acme', repos: ['api', 'web'] },
    });
  });

  it('previews advanced combinations', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockResolvedValue({
      ...FIXTURE_PREVIEW,
      integrations: ['github', 'jira', 'bitbucket'],
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('bootstrap-mode-advanced'));
    await user.type(screen.getByTestId('bootstrap-github-repos-input'), 'octo/widgets');
    await user.type(screen.getByTestId('bootstrap-jira-base-url-input'), 'https://example.net');
    await user.type(screen.getByTestId('bootstrap-jira-keys-input'), 'ENG');
    await user.type(screen.getByTestId('bootstrap-bitbucket-workspace-input'), 'acme');
    await user.type(screen.getByTestId('bootstrap-bitbucket-repos-input'), 'api');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() => expect(screen.getByTestId('step-preview')).toBeTruthy());
    expect(previewLocalProjectCreation).toHaveBeenCalledWith({
      slug: undefined,
      name: undefined,
      source: {
        kind: 'advanced',
        github: { repoRefs: ['octo/widgets'] },
        jira: {
          baseUrl: 'https://example.net',
          projectKeys: ['ENG'],
          importMode: 'manual',
        },
        bitbucket: { workspace: 'acme', repos: ['api'] },
      },
    });
  });

  it('rejects invalid advanced GitHub refs instead of dropping them', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByTestId('bootstrap-mode-advanced'));
    await user.type(screen.getByTestId('bootstrap-github-repos-input'), 'not-a-ref');
    await user.type(screen.getByTestId('bootstrap-jira-base-url-input'), 'https://example.net');
    await user.type(screen.getByTestId('bootstrap-jira-keys-input'), 'ENG');
    await user.click(screen.getByTestId('wizard-next'));

    await waitFor(() => expect(screen.getByTestId('wizard-error')).toBeTruthy());
    expect(screen.getByTestId('wizard-error').textContent).toContain(
      'GitHub repositories must look like "owner/repo"',
    );
    expect(previewLocalProjectCreation).not.toHaveBeenCalled();
  });

  it('surfaces preview errors in a banner', async () => {
    const { previewLocalProjectCreation } = await import('@/lib/api');
    vi.mocked(previewLocalProjectCreation).mockRejectedValue(new Error('bad source'));

    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByTestId('bootstrap-slug-input'), 'widgets');
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('wizard-error')).toBeTruthy());
    expect(screen.getByTestId('wizard-error').textContent).toContain('bad source');
    expect(screen.getByTestId('step-source')).toBeTruthy();
  });
});
