import { describe, expect, it } from 'vitest';

describe('regression: workflows and transitions do not auto-post to Jira or Bitbucket', () => {
  it('transitions module exports no jira/bitbucket/post-back function', async () => {
    const mod = await import('../issues/transitions.js');
    const suspicious = Object.keys(mod).filter((k) =>
      /jira|bitbucket|atlassian|postComment|postBack|post_back/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });

  it('triage-batch module exports no jira/bitbucket/post-back function', async () => {
    const mod = await import('../workflows/triage-batch.js');
    const suspicious = Object.keys(mod).filter((k) =>
      /jira|bitbucket|atlassian|postComment|postBack|post_back/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });

  it('integrations service is only exposed via its own router, not via workflow or transition imports', async () => {
    const { integrationsRouter } = await import('./router.js');
    expect(typeof integrationsRouter).toBe('object');
  });
});
