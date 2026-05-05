import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'proj/developer/0' }),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

const mockReadFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
});

const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runResolveConflictWorkflow } from './workflow.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Fix bug',
    body: 'Fix the bug',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:merge-conflict',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeStateSource(): StateSource {
  return {
    projectId: 'proj',
    repoRef: 'owner/repo',
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn(),
    watchForUpdates: vi.fn(),
  } as unknown as StateSource;
}

const PR_OPENED_EVENT = {
  id: 1,
  projectId: 'proj',
  workItemId: 'github:owner/repo#42',
  kind: 'pr.opened',
  runId: 'run-1',
  payload: {
    prNumber: 99,
    prUrl: 'https://github.com/owner/repo/pull/99',
    branch: 'factory/run-1',
    baseBranch: 'main',
    devRunId: 'run-1',
  },
  createdAt: '2026-05-05T10:00:00Z',
};

const SUCCESS_AGENT_OUTPUT: AgentResult = {
  output: {
    resolved: ['src/foo.ts'],
    unresolvable: [],
    confidence: 'high',
    decisionSummaries: [{ step: 'resolve', summary: 'Merged both changes in foo.ts' }],
  },
  decisionSummaries: [],
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: file content is clean (no conflict markers).
  mockReadFileSync.mockReturnValue('# clean file content\nconst x = 1;\n');
  process.env.GITHUB_TOKEN = 'ghp_test';
});

afterEach(() => {
  process.env.GITHUB_TOKEN = undefined;
});

describe('runResolveConflictWorkflow', () => {
  it('no pr.opened event → transitions to needs-human and posts comment', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {});
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('no pr.opened event'),
    );
  });

  it('happy path: resolves conflicts, pushes, merges, transitions to retrospecting', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => {
        throw new Error('CONFLICT (content): merge conflict');
      }) // merge fails = conflict
      .mockReturnValueOnce('src/foo.ts\n') // diff --name-only --diff-filter=U
      .mockReturnValueOnce('') // add -A
      .mockReturnValueOnce('') // commit
      .mockReturnValueOnce('') // push
      .mockReturnValueOnce(''); // worktree remove

    mockClaudeCliRun.mockResolvedValueOnce(SUCCESS_AGENT_OUTPUT);
    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc123', merged: true });

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', prNumber: 99 }),
    );
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:retrospecting',
    );
    const resolvedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'merge.conflict-resolved');
    expect(resolvedEvent).toBeDefined();
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('resolved automatically'),
    );
  });

  it('agent returns unresolvable files → transitions to needs-human', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockImplementationOnce(() => {
        throw new Error('conflict');
      }) // merge fails
      .mockReturnValueOnce('src/hard.ts\n') // conflicted files
      .mockReturnValueOnce(''); // worktree remove

    const agentOutput: AgentResult = {
      output: {
        resolved: [],
        unresolvable: ['src/hard.ts'],
        confidence: 'low',
        decisionSummaries: [{ step: 'resolve', summary: 'Could not resolve hard.ts' }],
      },
      decisionSummaries: [],
      events: [],
    };
    mockClaudeCliRun.mockResolvedValueOnce(agentOutput);
    const mergePRImpl = vi.fn();

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('https://github.com/owner/repo/pull/99'),
    );
  });

  it('agent reports low confidence → transitions to needs-human (no merge attempt)', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw new Error('conflict');
      })
      .mockReturnValueOnce('src/foo.ts\n')
      .mockReturnValueOnce('');

    const lowConfidence: AgentResult = {
      output: {
        resolved: ['src/foo.ts'],
        unresolvable: [],
        confidence: 'low',
        decisionSummaries: [{ step: 'resolve', summary: 'Uncertain — picked PR side blindly' }],
      },
      decisionSummaries: [],
      events: [],
    };
    mockClaudeCliRun.mockResolvedValueOnce(lowConfidence);
    const mergePRImpl = vi.fn();

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
  });

  it('defensive scan: resolved file still has markers → transitions to needs-human', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw new Error('conflict');
      })
      .mockReturnValueOnce('src/foo.ts\n')
      .mockReturnValueOnce('');

    // Skill claims resolved, but the file in the worktree still has markers.
    // The prompt read (skills/resolve-conflict/skill.md) returns clean content;
    // the worktree file read returns the unresolved markers.
    mockReadFileSync.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith('skill.md')) return '# mock prompt';
      return '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> main\n';
    });
    mockClaudeCliRun.mockResolvedValueOnce(SUCCESS_AGENT_OUTPUT);
    const mergePRImpl = vi.fn();

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      runtime: { run: mockClaudeCliRun } as unknown as AgentRuntime,
      mergePRImpl,
      gitExecImpl,
    });

    expect(mergePRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
    const unresolvable = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'merge.conflict-unresolvable');
    expect(unresolvable).toBeDefined();
  });

  it('mergePR throws → transitions to needs-human', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([PR_OPENED_EVENT] as never);

    const gitExecImpl = vi
      .fn()
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // clean merge (no conflict)
      .mockReturnValueOnce('') // push
      .mockReturnValueOnce(''); // worktree remove

    const mergePRImpl = vi.fn().mockRejectedValueOnce(new Error('GitHub 422 — PR already merged'));

    const source = makeStateSource();
    await runResolveConflictWorkflow(makeWorkItem(), source, 'proj', '/repo', {
      mergePRImpl,
      gitExecImpl,
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:merge-conflict',
      'factory:needs-human',
    );
  });
});
