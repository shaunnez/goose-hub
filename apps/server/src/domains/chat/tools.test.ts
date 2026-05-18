import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all upstream dependencies before importing tools.ts so the module-time
// imports resolve cleanly.
const mockListOpenWork = vi.fn();
const mockGetItem = vi.fn();
const mockListMilestones = vi.fn();
const mockTransitionState = vi.fn();
const mockComment = vi.fn();

vi.mock('#shared/source.js', () => ({
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
  getSourceForSlug: vi.fn(async (slug: string) => {
    if (slug === 'unknown') return null;
    return {
      projectId: slug,
      repoRef: `shaunnez/${slug}`,
      listOpenWork: mockListOpenWork,
      getItem: mockGetItem,
      listMilestones: mockListMilestones,
      transitionState: mockTransitionState,
      comment: mockComment,
    };
  }),
}));

vi.mock('#shared/inbox-bridge.js', () => ({
  addInboxNote: vi.fn(async (_input: { title: string }) => ({ id: 42 })),
}));

interface BootstrapBridgeResult {
  ok: boolean;
  slug?: string;
  status?: 'created' | 'idempotent-skip';
  registrationPrUrl?: string | null;
  stackSummary?: string;
  auditAction?: string;
  labelCounts?: { created: number; updated: number; skipped: number };
  error?: string;
  errorStatus?: number;
}
const mockRunBootstrapViaBridge: ReturnType<typeof vi.fn> = vi.fn(
  async (): Promise<BootstrapBridgeResult> => ({
    ok: true,
    slug: 'widgets',
    status: 'created',
    registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
    stackSummary: 'Node + pnpm',
    auditAction: 'ok',
    labelCounts: { created: 10, updated: 0, skipped: 0 },
  }),
);
vi.mock('#shared/bootstrap-bridge.js', () => ({
  runBootstrapViaBridge: (repoRef: string, slug?: string) =>
    mockRunBootstrapViaBridge(repoRef, slug),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn(() => []),
    appendEvent: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  loadProjects: vi.fn(async () => [
    {
      slug: 'goose-hub-self',
      name: 'Goose Hub (self)',
      mode: 'supervised',
      activeMilestone: 'M20',
      source: { kind: 'github', repo: 'shaunnez/goose-hub' },
    },
  ]),
}));

const mockReadProjectSettings: ReturnType<typeof vi.fn> = vi.fn(() => null);
const mockWriteProjectSettings: ReturnType<typeof vi.fn> = vi.fn();
const mockGetUseMultiAgentPipeline: ReturnType<typeof vi.fn> = vi.fn(() => false);
const mockGetUseInvestigationSwarm: ReturnType<typeof vi.fn> = vi.fn(() => true);

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  readProjectSettings: (id: string) => mockReadProjectSettings(id),
  writeProjectSettings: (id: string, patch: Record<string, unknown>, by: string) =>
    mockWriteProjectSettings(id, patch, by),
  getUseMultiAgentPipeline: (id: string) => mockGetUseMultiAgentPipeline(id),
  getUseInvestigationSwarm: (id: string, configDefault?: boolean) =>
    mockGetUseInvestigationSwarm(id, configDefault),
}));

const mockResolveActiveMilestone: ReturnType<typeof vi.fn> = vi.fn(async () => ({
  milestoneNumber: 20,
  source: 'project_state',
}));
vi.mock('#shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: (slug: string) => mockResolveActiveMilestone(slug),
}));

interface BridgeResult {
  ok: boolean;
  milestoneNumber: number | null;
  error?: string;
}
const mockSetActiveMilestoneViaBridge: ReturnType<typeof vi.fn> = vi.fn(
  async (): Promise<BridgeResult> => ({ ok: true, milestoneNumber: 7 }),
);
vi.mock('#shared/milestone-bridge.js', () => ({
  setActiveMilestoneViaBridge: (slug: string, n: number | null) =>
    mockSetActiveMilestoneViaBridge(slug, n),
}));

const mockGetProject: ReturnType<typeof vi.fn> = vi.fn(async () => null);
vi.mock('#shared/projects.js', () => ({
  getProject: (slug: string) => mockGetProject(slug),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { CHAT_TOOL_IMPLEMENTATIONS, ToolExecutionError } from './tools.js';

const ctx = { conversationId: 'conv_test', projectId: null, workItemId: null };

function workItem(
  overrides: Partial<{ id: string; externalId: string; title: string; state: string }>,
) {
  return {
    id: 'github:shaunnez/goose-hub#1',
    externalId: '1',
    repoRef: 'shaunnez/goose-hub',
    title: 'Item 1',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:in-progress',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('chat-tools — list_projects', () => {
  it('returns slug/name/mode/activeMilestone tuples', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_projects({}, ctx)) as {
      projects: Array<{ slug: string; name: string; mode: string; activeMilestone: string | null }>;
    };
    expect(result.projects[0]).toMatchObject({
      slug: 'goose-hub-self',
      name: 'Goose Hub (self)',
      mode: 'supervised',
    });
  });
});

describe('chat-tools — list_open_issues', () => {
  it('returns mapped items with an in-app path', async () => {
    mockListOpenWork.mockResolvedValueOnce([workItem({ externalId: '7', title: 'Seven' })]);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_open_issues(
      { projectSlug: 'goose-hub-self' },
      ctx,
    )) as { items: Array<{ path: string; number: string }> };
    expect(result.items[0].number).toBe('7');
    expect(result.items[0].path).toBe('/projects/goose-hub-self/items/7');
  });

  it('honours the state filter', async () => {
    mockListOpenWork.mockResolvedValueOnce([
      workItem({ externalId: '1', state: 'factory:in-progress' }),
      workItem({ externalId: '2', state: 'factory:needs-human' }),
      workItem({ externalId: '3', state: 'factory:gate-pending' }),
    ]);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_open_issues(
      { projectSlug: 'goose-hub-self', state: 'needs-human' },
      ctx,
    )) as { items: Array<{ number: string }>; appliedStateFilter: string };
    expect(result.items.map((i) => i.number)).toEqual(['2']);
    expect(result.appliedStateFilter).toBe('needs-human');
  });

  it('rejects an unknown project with a 404 ToolExecutionError', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.list_open_issues({ projectSlug: 'unknown' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe('chat-tools — get_issue', () => {
  it('returns body and path', async () => {
    mockGetItem.mockResolvedValueOnce(workItem({ externalId: '42', title: 'Hello' }));
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.get_issue(
      { projectSlug: 'goose-hub-self', issueNumber: 42 },
      ctx,
    )) as { number: string; path: string };
    expect(result.number).toBe('42');
    expect(result.path).toBe('/projects/goose-hub-self/items/42');
  });
});

describe('chat-tools — transition_issue', () => {
  it('calls source.transitionState with the resolved from-state', async () => {
    mockGetItem.mockResolvedValueOnce(workItem({ externalId: '5', state: 'factory:in-progress' }));
    mockTransitionState.mockResolvedValueOnce(undefined);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.transition_issue(
      {
        projectSlug: 'goose-hub-self',
        issueNumber: 5,
        toState: 'factory:done',
        rationale: 'finished',
      },
      ctx,
    )) as { ok: boolean; from: string; to: string };
    expect(mockTransitionState).toHaveBeenCalledWith('5', 'factory:in-progress', 'factory:done');
    expect(result).toEqual({ ok: true, from: 'factory:in-progress', to: 'factory:done' });
  });
});

describe('chat-tools — comment_on_issue', () => {
  it('posts the comment via source.comment', async () => {
    mockComment.mockResolvedValueOnce(undefined);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.comment_on_issue(
      { projectSlug: 'goose-hub-self', issueNumber: 9, body: 'hello' },
      ctx,
    )) as { ok: boolean };
    expect(mockComment).toHaveBeenCalledWith('9', 'hello');
    expect(result.ok).toBe(true);
  });
});

describe('chat-tools — find_pr', () => {
  it('scopes the event-stream replay to the requested project', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    await CHAT_TOOL_IMPLEMENTATIONS.find_pr({ query: '123', projectSlug: 'goose-hub-self' }, ctx);
    expect(eventStore.replay).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'goose-hub-self' }),
    );
  });
});

describe('chat-tools — create_inbox_note', () => {
  it('delegates to the shared inbox-bridge', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.create_inbox_note(
      { title: 'follow up on retro' },
      ctx,
    )) as { ok: boolean; id: number };
    expect(result.id).toBe(42);
  });
});

describe('chat-tools — open_url', () => {
  it('echoes the path so the UI can navigate', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.open_url(
      { path: '/projects/goose-hub-self', rationale: 'show kanban' },
      ctx,
    )) as { ok: boolean; path: string };
    expect(result).toEqual({ ok: true, path: '/projects/goose-hub-self' });
  });
});

describe('chat-tools — subscribe_to_run', () => {
  it('registers a watch in the shared registry for the given runId', async () => {
    const { getWatchRegistry, __resetWatchRegistryForTests } = await import('./watch-singleton.js');
    __resetWatchRegistryForTests();
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.subscribe_to_run(
      { runId: 'run_test_alpha', rationale: 'long investigation' },
      { ...ctx, conversationId: 'conv_subscribe' },
    )) as { ok: boolean; watchId: string; runId: string; expiresAt: string };

    expect(result.ok).toBe(true);
    expect(result.runId).toBe('run_test_alpha');
    expect(getWatchRegistry().listForConversation('conv_subscribe')).toHaveLength(1);
    __resetWatchRegistryForTests();
  });
});

describe('chat-tools — subscribe_to_issue', () => {
  it('resolves project + workItemId then registers a watch', async () => {
    const { getWatchRegistry, __resetWatchRegistryForTests } = await import('./watch-singleton.js');
    __resetWatchRegistryForTests();
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.subscribe_to_issue(
      { projectSlug: 'goose-hub-self', issueNumber: 42, rationale: 'awaiting QA' },
      { ...ctx, conversationId: 'conv_subscribe_issue' },
    )) as {
      ok: boolean;
      workItemId: string;
      projectId: string;
    };

    expect(result.ok).toBe(true);
    expect(result.workItemId).toBe('github:shaunnez/goose-hub-self#42');
    expect(result.projectId).toBe('goose-hub-self');
    expect(getWatchRegistry().listForConversation('conv_subscribe_issue')).toHaveLength(1);
    __resetWatchRegistryForTests();
  });

  it('returns a 404 ToolExecutionError when the project is unknown', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.subscribe_to_issue(
        { projectSlug: 'unknown', issueNumber: 1, rationale: 'x' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe('chat-tools — get_settings', () => {
  it('returns resolved budgets, flags, and active milestone', async () => {
    mockReadProjectSettings.mockReturnValueOnce({
      perWorkflowMaxUsd: 0.5,
      perAgentMaxUsd: 0.1,
      perAdvisorMaxUsd: 0.05,
      dailyTokens: 1_000_000,
      maxParallelAgents: 2,
      maxRetries: 3,
      perBashCommandMaxSeconds: null,
      qaE2eMode: 'ui-changed',
    } as unknown as ReturnType<typeof mockReadProjectSettings>);
    mockGetUseMultiAgentPipeline.mockReturnValueOnce(true);
    mockGetUseInvestigationSwarm.mockReturnValueOnce(true);
    mockGetProject.mockResolvedValueOnce(null);

    const result = (await CHAT_TOOL_IMPLEMENTATIONS.get_settings(
      { projectSlug: 'goose-hub-self' },
      ctx,
    )) as {
      projectId: string;
      settings: Record<string, unknown>;
      effective: Record<string, unknown>;
      activeMilestone: { milestoneNumber: number | null; source: string };
    };
    expect(result.projectId).toBe('goose-hub-self');
    expect(result.settings.perWorkflowMaxUsd).toBe(0.5);
    expect(result.settings.useMultiAgentPipeline).toBe(true);
    expect(result.settings.qaE2eMode).toBe('ui-changed');
    expect(result.activeMilestone.milestoneNumber).toBe(20);
    // effective falls back to override values when no config defaults available
    expect(result.effective.perWorkflowMaxUsd).toBe(0.5);
  });

  it('falls back to project config budgets when no override row exists', async () => {
    mockReadProjectSettings.mockReturnValueOnce(null);
    mockGetUseMultiAgentPipeline.mockReturnValueOnce(false);
    mockGetUseInvestigationSwarm.mockReturnValueOnce(false);
    mockGetProject.mockResolvedValueOnce({
      id: 'goose-hub-self',
      slug: 'goose-hub-self',
      budgets: {
        perWorkflowMaxUsd: 0.4,
        perAgentMaxUsd: 0.08,
        perAdvisorMaxUsd: 0.03,
        maxParallelAgents: 3,
        maxRetries: 2,
      },
      investigationSwarm: { enabled: false },
    });

    const result = (await CHAT_TOOL_IMPLEMENTATIONS.get_settings(
      { projectSlug: 'goose-hub-self' },
      ctx,
    )) as {
      settings: Record<string, unknown>;
      effective: Record<string, unknown>;
    };
    expect(result.settings.perWorkflowMaxUsd).toBeNull();
    expect(result.effective.perWorkflowMaxUsd).toBe(0.4);
    expect(result.effective.maxParallelAgents).toBe(3);
    expect(mockGetUseInvestigationSwarm).toHaveBeenCalledWith('goose-hub-self', false);
  });

  it('rejects unknown projects with a 404', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.get_settings({ projectSlug: 'unknown' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe('chat-tools — update_settings', () => {
  it('writes a numeric budget through writeProjectSettings', async () => {
    mockWriteProjectSettings.mockClear();
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.update_settings(
      {
        projectSlug: 'goose-hub-self',
        key: 'perWorkflowMaxUsd',
        value: 0.75,
        rationale: 'cap chat budget',
      },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      { perWorkflowMaxUsd: 0.75 },
      'chat',
    );
  });

  it('coerces a boolean flag to 0/1 for the DB row', async () => {
    mockWriteProjectSettings.mockClear();
    await CHAT_TOOL_IMPLEMENTATIONS.update_settings(
      {
        projectSlug: 'goose-hub-self',
        key: 'useMultiAgentPipeline',
        value: true,
        rationale: 'try multi-agent',
      },
      ctx,
    );
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      { useMultiAgentPipeline: 1 },
      'chat',
    );
  });

  it('rejects a string for a numeric budget key', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.update_settings(
        {
          projectSlug: 'goose-hub-self',
          key: 'perWorkflowMaxUsd',
          value: 'cheap',
          rationale: 'bad type',
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('rejects integer values above the upper cap (maxParallelAgents > 50)', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.update_settings(
        {
          projectSlug: 'goose-hub-self',
          key: 'maxParallelAgents',
          value: 100_000,
          rationale: 'wildly high',
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolExecutionError',
      message: expect.stringContaining('between 0 and 50'),
    });
  });

  it('rejects maxRetries above its upper cap', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.update_settings(
        {
          projectSlug: 'goose-hub-self',
          key: 'maxRetries',
          value: 200,
          rationale: 'too many retries',
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolExecutionError',
      message: expect.stringContaining('between 0 and 20'),
    });
  });

  it('rejects an out-of-range qaE2eMode value', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.update_settings(
        {
          projectSlug: 'goose-hub-self',
          key: 'qaE2eMode',
          value: 'maybe',
          rationale: 'invalid enum',
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('rejects an unknown key even when supplied at the implementation layer', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.update_settings(
        {
          projectSlug: 'goose-hub-self',
          key: 'apiKey' as never,
          value: 'sk-leak',
          rationale: 'should fail',
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe('chat-tools — set_active_milestone', () => {
  it('delegates to the milestone bridge', async () => {
    mockSetActiveMilestoneViaBridge.mockResolvedValueOnce({
      ok: true,
      milestoneNumber: 21,
    });
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.set_active_milestone(
      {
        projectSlug: 'goose-hub-self',
        milestoneNumber: 21,
        rationale: 'flip to next',
      },
      ctx,
    )) as { ok: boolean; milestoneNumber: number | null; cleared: boolean };
    expect(result).toEqual({ ok: true, milestoneNumber: 21, cleared: false });
    expect(mockSetActiveMilestoneViaBridge).toHaveBeenCalledWith('goose-hub-self', 21);
  });

  it('surfaces a project-not-found error as a 404 ToolExecutionError', async () => {
    mockSetActiveMilestoneViaBridge.mockResolvedValueOnce({
      ok: false,
      milestoneNumber: null,
      error: 'project not found',
    });
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.set_active_milestone(
        {
          projectSlug: 'goose-hub-self',
          milestoneNumber: 7,
          rationale: 'x',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError', status: 404 });
  });

  it('supports clearing the override with milestoneNumber=null', async () => {
    mockSetActiveMilestoneViaBridge.mockResolvedValueOnce({
      ok: true,
      milestoneNumber: null,
      cleared: true,
    });
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.set_active_milestone(
      {
        projectSlug: 'goose-hub-self',
        milestoneNumber: null,
        rationale: 'clear',
      },
      ctx,
    )) as { ok: boolean; milestoneNumber: number | null; cleared: boolean };
    expect(result.milestoneNumber).toBeNull();
    expect(result.cleared).toBe(true);
  });
});

describe('chat-tools — bootstrap_project', () => {
  beforeEach(() => {
    mockRunBootstrapViaBridge.mockReset();
  });

  it('runs the bootstrap workflow via the shared bridge and returns the registration PR url', async () => {
    mockRunBootstrapViaBridge.mockResolvedValueOnce({
      ok: true,
      slug: 'widgets',
      status: 'created',
      registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
      stackSummary: 'Node + pnpm',
      auditAction: 'create',
      labelCounts: { created: 10, updated: 0, skipped: 0 },
    });
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project(
      {
        repoUrl: 'https://github.com/octo/widgets',
        slug: 'widgets',
        mode: 'supervised',
        rationale: 'onboard widgets',
      },
      ctx,
    )) as {
      ok: boolean;
      slug: string;
      registrationPrUrl: string | null;
      path: string;
      requestedMode: string | null;
    };
    expect(result.ok).toBe(true);
    expect(result.slug).toBe('widgets');
    expect(result.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/999');
    expect(result.path).toBe('/projects/widgets');
    expect(result.requestedMode).toBe('supervised');
    expect(mockRunBootstrapViaBridge).toHaveBeenCalledWith('octo/widgets', 'widgets');
  });

  it('accepts an owner/repo shorthand and a git@ SSH URL', async () => {
    mockRunBootstrapViaBridge.mockResolvedValue({
      ok: true,
      slug: 'a',
      status: 'created',
      registrationPrUrl: null,
      stackSummary: 's',
      auditAction: 'ok',
    });
    await CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project(
      { repoUrl: 'octo/alpha', rationale: 'a' },
      ctx,
    );
    expect(mockRunBootstrapViaBridge).toHaveBeenLastCalledWith('octo/alpha', undefined);

    await CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project(
      { repoUrl: 'git@github.com:octo/beta.git', rationale: 'b' },
      ctx,
    );
    expect(mockRunBootstrapViaBridge).toHaveBeenLastCalledWith('octo/beta', undefined);
  });

  it('rejects an unparseable repoUrl with a 400 ToolExecutionError', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project({ repoUrl: 'not a url', rationale: 'x' }, ctx),
    ).rejects.toMatchObject({ name: 'ToolExecutionError', status: 400 });
    expect(mockRunBootstrapViaBridge).not.toHaveBeenCalled();
  });

  it('rejects an invalid slug before calling the workflow', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project(
        {
          repoUrl: 'octo/widgets',
          slug: 'Bad Slug!',
          rationale: 'bad',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError', status: 400 });
    expect(mockRunBootstrapViaBridge).not.toHaveBeenCalled();
  });

  it('surfaces bridge errors with their original status code', async () => {
    mockRunBootstrapViaBridge.mockResolvedValueOnce({
      ok: false,
      error: 'server is missing GITHUB_TOKEN',
      errorStatus: 500,
    });
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.bootstrap_project({ repoUrl: 'octo/widgets', rationale: 'x' }, ctx),
    ).rejects.toMatchObject({ name: 'ToolExecutionError', status: 500 });
  });
});
