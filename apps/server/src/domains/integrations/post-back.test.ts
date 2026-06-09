import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListExternalRefs, mockGetProject } = vi.hoisted(() => ({
  mockListExternalRefs: vi.fn().mockReturnValue([]),
  mockGetProject: vi.fn(),
}));

vi.mock('@goose-hub/core/integrations/jira/comment.js', () => ({
  postJiraComment: vi.fn(),
}));
vi.mock('@goose-hub/core/integrations/bitbucket/comment.js', () => ({
  postBitbucketComment: vi.fn(),
}));
vi.mock('@goose-hub/core/integrations/post-back/store.js', () => ({
  storeCommentRef: vi.fn(),
}));
vi.mock('@goose-hub/core/state-source/local-db-repository.js', () => ({
  LocalDbWorkItemRepository: vi.fn().mockImplementation(() => ({
    listExternalRefs: mockListExternalRefs,
  })),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: mockGetProject,
}));

import { postBitbucketComment } from '@goose-hub/core/integrations/bitbucket/comment.js';
import { postJiraComment } from '@goose-hub/core/integrations/jira/comment.js';
import { storeCommentRef } from '@goose-hub/core/integrations/post-back/store.js';
import { checkPostBackAvailability, executePostBack, sanitizePostBackText } from './post-back.js';

describe('sanitizePostBackText', () => {
  it('strips HTML tags', () => {
    expect(sanitizePostBackText('<b>hello</b> world')).toBe('hello world');
  });

  it('caps at 5000 chars', () => {
    expect(sanitizePostBackText('a'.repeat(6000))).toHaveLength(5000);
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizePostBackText('  hello  ')).toBe('hello');
  });

  it('returns empty string when only HTML/whitespace', () => {
    expect(sanitizePostBackText('  <br/>  ')).toBe('');
  });
});

describe('checkPostBackAvailability', () => {
  beforeEach(() => {
    mockListExternalRefs.mockReturnValue([]);
  });

  it('returns false for both when no refs exist', () => {
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: false,
      bitbucket: false,
    });
  });

  it('returns jira:true when jira issue ref exists', () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: true,
      bitbucket: false,
    });
  });

  it('returns bitbucket:true when bitbucket pull_request ref exists', () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'bitbucket', kind: 'pull_request', externalId: '42', repoRef: 'ws/repo' },
    ]);
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: false,
      bitbucket: true,
    });
  });
});

describe('executePostBack', () => {
  beforeEach(() => {
    mockListExternalRefs.mockReturnValue([]);
    vi.mocked(postJiraComment).mockReset();
    vi.mocked(postBitbucketComment).mockReset();
    vi.mocked(storeCommentRef).mockReset();
    mockGetProject.mockResolvedValue({
      id: 'proj',
      source: {
        kind: 'local-db',
        integrations: {
          jira: { baseUrl: 'https://test.atlassian.net', enabled: true },
          bitbucket: { workspace: 'ws', enabled: true },
        },
      },
    });
    vi.stubEnv('JIRA_EMAIL', 'user@test.com');
    vi.stubEnv('JIRA_API_TOKEN', 'jira-secret');
    vi.stubEnv('BITBUCKET_USERNAME', 'bbuser');
    vi.stubEnv('BITBUCKET_TOKEN', 'bb-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns no-ref error when no Jira ref is linked', async () => {
    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Some text',
    });
    expect(result).toEqual({ ok: false, error: 'no-ref', detail: expect.any(String) });
  });

  it('returns no-credentials error when JIRA_API_TOKEN is missing', async () => {
    vi.stubEnv('JIRA_API_TOKEN', '');
    vi.stubEnv('ATLASSIAN_API_TOKEN', '');
    vi.stubEnv('JIRA_TOKEN', '');
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Some text',
    });
    expect(result).toEqual({ ok: false, error: 'no-credentials', detail: expect.any(String) });
  });

  it('calls postJiraComment and stores ref on success', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: true,
      commentId: 'c-1',
      url: 'https://jira/c-1',
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Summary text',
    });

    expect(postJiraComment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'PROJ-1',
        repoRef: null,
        text: 'Summary text',
        baseUrl: 'https://test.atlassian.net',
        email: 'user@test.com',
        token: 'jira-secret',
      }),
    );
    expect(storeCommentRef).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj',
        workItemId: 'item-1',
        provider: 'jira',
        commentId: 'c-1',
        url: 'https://jira/c-1',
        repoRef: null,
        sourceKind: 'prd-summary',
      }),
    );
    expect(result).toEqual({
      ok: true,
      provider: 'jira',
      commentId: 'c-1',
      url: 'https://jira/c-1',
    });
  });

  it('returns provider-failure without storing ref on adapter error', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: false,
      httpStatus: 503,
      detail: 'Service unavailable',
    });

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Summary text',
    });

    expect(storeCommentRef).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: 'provider-failure',
      detail: 'Service unavailable',
    });
  });

  it('strips HTML from text before calling adapter', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: true,
      commentId: 'c-2',
      url: null,
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: '<script>alert("xss")</script>Real content',
    });

    expect(postJiraComment).toHaveBeenCalledWith(expect.objectContaining({ text: 'Real content' }));
  });

  it('returns empty-text error when text is blank after sanitization', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: '<br/><br/>',
    });

    expect(postJiraComment).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'empty-text', detail: expect.any(String) });
  });

  it('calls postBitbucketComment for bitbucket provider', async () => {
    mockListExternalRefs.mockReturnValue([
      {
        provider: 'bitbucket',
        kind: 'pull_request',
        externalId: '7',
        repoRef: 'ws/repo',
      },
    ]);
    vi.mocked(postBitbucketComment).mockResolvedValue({
      ok: true,
      commentId: '55',
      url: 'https://bb/55',
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'bitbucket',
      kind: 'investigation-summary',
      text: 'Investigation findings',
    });

    expect(postBitbucketComment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '7',
        repoRef: 'ws/repo',
        text: 'Investigation findings',
        username: 'bbuser',
        token: 'bb-secret',
      }),
    );
    expect(result).toEqual({
      ok: true,
      provider: 'bitbucket',
      commentId: '55',
      url: 'https://bb/55',
    });
  });
});
