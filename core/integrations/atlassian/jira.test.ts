import { describe, expect, it } from 'vitest';
import { parseJiraIssueRef } from './jira.js';

const config = {
  baseUrl: 'https://company.atlassian.net',
  projectKeys: ['TAS', 'OPS'],
};

describe('Jira key and URL parsing', () => {
  it('resolves exact Jira keys as L0 refs', () => {
    expect(parseJiraIssueRef('TAS-123', config)).toEqual({
      ok: true,
      ref: {
        provider: 'jira',
        level: 'L0',
        key: 'TAS-123',
        projectKey: 'TAS',
        url: 'https://company.atlassian.net/browse/TAS-123',
      },
    });
  });

  it('resolves configured browse URLs as L0 refs', () => {
    expect(
      parseJiraIssueRef('https://company.atlassian.net/browse/OPS-9?focusedCommentId=1', config),
    ).toEqual({
      ok: true,
      ref: {
        provider: 'jira',
        level: 'L0',
        key: 'OPS-9',
        projectKey: 'OPS',
        url: 'https://company.atlassian.net/browse/OPS-9',
      },
    });
  });

  it('rejects unconfigured project keys and browse hosts', () => {
    expect(parseJiraIssueRef('ABC-1', config)).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect(parseJiraIssueRef('https://evil.example/browse/TAS-123', config)).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
  });
});
