import { describe, expect, it } from 'vitest';
import type { LocalDbSourceConfig } from './types.js';

describe('LocalDbSourceConfig Atlassian integration typing', () => {
  it('permits Jira and Bitbucket integration blocks without credentials', () => {
    const config = {
      kind: 'local-db',
      stateMachine: 'db',
      integrations: {
        jira: {
          enabled: true,
          baseUrl: 'https://company.atlassian.net',
          projectKeys: ['TAS', 'OPS'],
          importMode: 'manual',
          postBack: {
            comments: true,
            transitions: false,
          },
        },
        bitbucket: {
          enabled: true,
          workspace: 'company',
          repos: ['api', 'web'],
          postBack: {
            pullRequests: true,
            comments: true,
          },
        },
      },
    } satisfies LocalDbSourceConfig;

    expect(config.integrations.jira.projectKeys).toEqual(['TAS', 'OPS']);
    expect(config.integrations.bitbucket.repos).toEqual(['api', 'web']);
  });
});

const _jiraCredentialsAreRejected = {
  kind: 'local-db',
  stateMachine: 'db',
  integrations: {
    jira: {
      enabled: true,
      baseUrl: 'https://company.atlassian.net',
      projectKeys: ['TAS'],
      importMode: 'manual',
      // @ts-expect-error credentials must not be accepted in project config
      token: 'secret',
    },
  },
} satisfies LocalDbSourceConfig;

const _bitbucketCredentialsAreRejected = {
  kind: 'local-db',
  stateMachine: 'db',
  integrations: {
    bitbucket: {
      enabled: true,
      workspace: 'company',
      repos: ['api'],
      postBack: {
        pullRequests: true,
        comments: true,
      },
      // @ts-expect-error credentials must not be accepted in project config
      password: 'secret',
    },
  },
} satisfies LocalDbSourceConfig;
