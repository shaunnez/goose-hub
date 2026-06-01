/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExternalRefsSection } from './ExternalRefsSection';

describe('ExternalRefsSection', () => {
  it('shows local-only status when no external refs are linked', () => {
    render(<ExternalRefsSection refs={[]} />);

    expect(screen.getByText('Local-only')).toBeTruthy();
    expect(screen.getByText('No external tracker or pull request linked')).toBeTruthy();
  });

  it('shows linked Jira and Bitbucket refs', () => {
    render(
      <ExternalRefsSection
        refs={[
          {
            id: 1,
            provider: 'jira',
            kind: 'issue',
            repoRef: null,
            externalId: 'TAS-123',
            url: 'https://company.atlassian.net/browse/TAS-123',
            metadata: { status: 'To Do' },
            createdAt: '2026-05-27T00:00:00Z',
          },
          {
            id: 2,
            provider: 'bitbucket',
            kind: 'pull_request',
            repoRef: 'workspace/repo',
            externalId: '45',
            url: 'https://bitbucket.org/workspace/repo/pull-requests/45',
            metadata: { state: 'OPEN' },
            createdAt: '2026-05-27T00:00:00Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('Linked external refs')).toBeTruthy();
    expect(screen.getByText('jira issue')).toBeTruthy();
    expect(screen.getByText('TAS-123')).toBeTruthy();
    expect(screen.getByText('bitbucket pull request')).toBeTruthy();
    expect(screen.getByText('workspace/repo #45')).toBeTruthy();
  });
});
