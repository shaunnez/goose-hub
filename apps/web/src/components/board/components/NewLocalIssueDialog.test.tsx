/** @vitest-environment jsdom */
import { createLocalIssue } from '@/lib/api';
import type { WorkItemDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewLocalIssueDialog } from './NewLocalIssueDialog';

vi.mock('@/lib/api', () => ({
  createLocalIssue: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

const CREATED_ITEM: WorkItemDto = {
  id: 'local:proj#1',
  canonicalWorkItemId: 'local:proj#1',
  externalId: '1',
  repoRef: 'owner/repo',
  title: 'Local task',
  body: '',
  type: 'chore',
  priority: 'medium',
  mode: 'supervised',
  state: 'factory:triaging',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  externalRefs: [],
  createdAt: new Date().toISOString(),
};

describe('NewLocalIssueDialog', () => {
  it('creates a local-only Work Item and reports the created item', async () => {
    vi.mocked(createLocalIssue).mockResolvedValueOnce(CREATED_ITEM);
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <NewLocalIssueDialog
        open
        projectSlug="local-proj"
        milestoneNumber={5}
        onCreated={onCreated}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Local task ' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Track locally.' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'chore' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createLocalIssue).toHaveBeenCalledTimes(1));
    expect(createLocalIssue).toHaveBeenCalledWith('local-proj', {
      title: 'Local task',
      body: 'Track locally.',
      type: 'chore',
      priority: 'high',
      milestoneNumber: 5,
    });
    expect(onCreated).toHaveBeenCalledWith(CREATED_ITEM);
    expect(onClose).toHaveBeenCalled();
  });

  it('requires a title before submitting', () => {
    render(
      <NewLocalIssueDialog
        open
        projectSlug="local-proj"
        milestoneNumber={null}
        onCreated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByTestId('new-local-issue-error').textContent).toContain('title is required');
    expect(createLocalIssue).not.toHaveBeenCalled();
  });
});
