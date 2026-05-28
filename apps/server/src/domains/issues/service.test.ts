import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetProject } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // Default: pass through to real readFileSync; individual tests can override
    readFileSync: vi.fn().mockImplementation(actual.readFileSync),
    existsSync: vi.fn().mockImplementation(actual.existsSync),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn().mockImplementation(actual.execFileSync),
  };
});

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
}));
vi.mock('@goose-hub/core/agent-artifacts/repository.js', () => ({
  getArtifact: vi.fn(),
}));
vi.mock('@goose-hub/core/engineering-specs/repository.js', () => ({
  getEngineeringSpec: vi.fn(),
}));
vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  cleanupWorktree: vi.fn(),
}));
vi.mock('@goose-hub/core/state-machine/states.js', () => ({
  STATES: [
    'factory:triaging',
    'factory:accepted',
    'factory:gate-pending',
    'factory:grilling',
    'factory:in-progress',
    'factory:needs-human',
    'factory:done',
    'factory:archived',
  ],
  TERMINAL_STATES: new Set(['factory:done', 'factory:archived']),
}));
vi.mock('@goose-hub/core/state-machine/transitions.js', () => ({
  isLegalTransition: vi.fn().mockReturnValue(true),
  legalTargets: vi.fn().mockReturnValue([]),
}));
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
  // Use the real implementation — defence-in-depth check is just a regex (#201).
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: mockGetProject,
}));
vi.mock('../../shared/cache.js', () => ({
  getCached: vi.fn().mockImplementation((_k, _t, f) => f()),
  bustCache: vi.fn(),
  CACHE_KEY: {
    issues: (s: string) => `issues:${s}`,
    milestones: (s: string) => `milestones:${s}`,
    closedIssues: (s: string, m: number) => `closed-issues:${s}:${m}`,
    milestoneIssues: (s: string, m: number) => `milestone-issues:${s}:${m}`,
  },
}));
vi.mock('../../shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: vi
    .fn()
    .mockResolvedValue({ milestoneNumber: null, source: 'github-default' }),
}));

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { getArtifact } from '@goose-hub/core/agent-artifacts/repository.js';
import { getEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { open } from '@goose-hub/core/interventions/reducer.js';
import {
  listInterventionEvents,
  listInterventions,
} from '@goose-hub/core/interventions/repository.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import { cleanupWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { bustCache } from '#shared/cache.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import {
  commentOnIssue,
  getIssue,
  getIssueArtifact,
  getIssueLegalTargets,
  getIssueSpec,
  listIssues,
  overrideIssueRepo,
  setIssueLabel,
  transitionIssue,
} from './service.js';

type MockSource = {
  repoRef: string;
  projectId: string;
  transitionState: ReturnType<typeof vi.fn>;
  comment: ReturnType<typeof vi.fn>;
  setMilestone: ReturnType<typeof vi.fn>;
  setLabelInGroup: ReturnType<typeof vi.fn>;
  listOpenWork: ReturnType<typeof vi.fn>;
  getItem: ReturnType<typeof vi.fn>;
  listComments: ReturnType<typeof vi.fn>;
};

const mockSource: MockSource = {
  repoRef: 'owner/repo',
  projectId: 'test-proj',
  transitionState: vi.fn().mockResolvedValue(undefined),
  comment: vi.fn().mockResolvedValue(undefined),
  setMilestone: vi.fn().mockResolvedValue(undefined),
  setLabelInGroup: vi.fn().mockResolvedValue(undefined),
  listOpenWork: vi.fn().mockResolvedValue([]),
  getItem: vi.fn(async (itemId: string) => ({
    id: `github:owner/repo#${itemId}`,
    externalId: itemId,
    repoRef: 'owner/repo',
    title: 'Issue',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
  })),
  listComments: vi.fn().mockResolvedValue([]),
};

function defaultMockItem(itemId: string) {
  return {
    id: `github:owner/repo#${itemId}`,
    externalId: itemId,
    repoRef: 'owner/repo',
    title: 'Issue',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
  };
}

function mockLocalDbProject(): void {
  mockGetProject.mockResolvedValueOnce({
    id: 'test-proj',
    source: { kind: 'local-db', stateMachine: 'db' },
    repos: ['owner/repo'],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProject.mockReset();
  vi.mocked(getSourceForSlug).mockReset();
  mockSource.getItem
    .mockReset()
    .mockImplementation(async (itemId: string) => defaultMockItem(itemId));
  mockSource.listComments.mockReset().mockResolvedValue([]);
  mockSource.transitionState.mockReset().mockResolvedValue(undefined);
  mockSource.comment.mockReset().mockResolvedValue(undefined);
  mockSource.setMilestone.mockReset().mockResolvedValue(undefined);
  mockSource.setLabelInGroup.mockReset().mockResolvedValue(undefined);
  mockSource.listOpenWork.mockReset().mockResolvedValue([]);
  mockGetProject.mockImplementation(async (slug) =>
    slug === 'unknown'
      ? null
      : ({
          id: 'test-proj',
          source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
          repos: ['owner/repo'],
        } as never),
  );
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(getArtifact).mockReturnValue(null);
  vi.mocked(getEngineeringSpec).mockReturnValue(null);
});

describe('getIssueSpec', () => {
  it('returns the expanded explicit Engineering Spec DTO', async () => {
    vi.mocked(getEngineeringSpec).mockReturnValue({
      id: 1,
      projectId: 'test-proj',
      workItemId: 'github:owner/repo#42',
      pipelineRunId: 'pipe-123',
      createdAt: '2026-05-22T09:00:00Z',
      updatedAt: '2026-05-22T10:00:00Z',
      spec: {
        objective: 'Build the authentication flow with token refresh.',
        architecture: {
          current: 'Refresh logic lives in the route.',
          new: 'Move refresh logic into middleware.',
          decisionRationale: 'Centralized session enforcement is easier to verify.',
        },
        schemaChanges: {
          ddl: ['ALTER TABLE sessions ADD COLUMN refreshed_at TEXT;'],
          migrations: ['migrations/20260522100000_refresh_sessions.sql'],
        },
        interfaceContracts: [
          {
            name: 'validateRefreshToken',
            signature: 'export function validateRefreshToken(token: string): Promise<AuthSession>;',
            file: 'src/auth/token.ts',
            lineRange: '12-20',
          },
        ],
        workPackages: [
          {
            id: 'WP1',
            filesOwned: ['src/auth/login.ts'],
            changes: 'Update login refresh flow.',
            dependsOn: [],
            builderTier: 'sonnet',
          },
        ],
        executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
        verificationTooling: [
          {
            name: 'Auth unit tests',
            command: 'pnpm vitest run src/auth/login.test.ts',
            expectedExitCodes: [0],
            inputSpec: 'Run from repo root.',
          },
        ],
        acceptanceCriteria: [
          {
            id: 'AC-1',
            statement: 'Users can log in with a valid refresh token.',
            executableChecks: [],
          },
          {
            id: 'AC-2',
            statement: 'Expired tokens are rejected.',
            executableChecks: [
              {
                id: 'AC-2-check-1',
                command: 'pnpm vitest run src/auth/token.test.ts',
                expectedExitCodes: [0],
                kind: 'unit',
              },
              {
                id: 'AC-2-check-2',
                command: 'pnpm vitest run src/auth/middleware.test.ts',
                expectedExitCodes: [0, 1],
                kind: 'integration',
              },
            ],
          },
        ],
        constraints: [
          {
            kind: 'phase',
            name: 'Investigation tab owns spec display',
            source: 'apps/web/src/components/detail/components/InvestigationSection.tsx:277',
          },
        ],
        riskRegister: [
          {
            risk: 'Refresh middleware could reject valid legacy sessions.',
            mitigation: 'Keep legacy fallback covered by tests.',
            severity: 'medium',
          },
        ],
        decisionSummaries: [{ kind: 'PLAN', summary: 'Keep DTO projection explicit.' }],
      },
    });

    const result = await getIssueSpec('test-proj', '42');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getEngineeringSpec).toHaveBeenCalledWith('test-proj', 'github:owner/repo#42');
    expect(result.data.spec).toMatchObject({
      pipelineRunId: 'pipe-123',
      updatedAt: '2026-05-22T10:00:00Z',
      objective: 'Build the authentication flow with token refresh.',
      architecture: {
        current: 'Refresh logic lives in the route.',
        new: 'Move refresh logic into middleware.',
        decisionRationale: 'Centralized session enforcement is easier to verify.',
      },
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['src/auth/login.ts'],
          changes: 'Update login refresh flow.',
          dependsOn: [],
          builderTier: 'sonnet',
        },
      ],
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
      verificationTooling: [
        {
          name: 'Auth unit tests',
          command: 'pnpm vitest run src/auth/login.test.ts',
          expectedExitCodes: [0],
          inputSpec: 'Run from repo root.',
        },
      ],
      interfaceContracts: [
        {
          name: 'validateRefreshToken',
          signature: 'export function validateRefreshToken(token: string): Promise<AuthSession>;',
          file: 'src/auth/token.ts',
          lineRange: '12-20',
        },
      ],
      schemaChanges: {
        ddl: ['ALTER TABLE sessions ADD COLUMN refreshed_at TEXT;'],
        migrations: ['migrations/20260522100000_refresh_sessions.sql'],
      },
      constraints: [
        {
          kind: 'phase',
          name: 'Investigation tab owns spec display',
          source: 'apps/web/src/components/detail/components/InvestigationSection.tsx:277',
        },
      ],
      riskRegister: [
        {
          risk: 'Refresh middleware could reject valid legacy sessions.',
          mitigation: 'Keep legacy fallback covered by tests.',
          severity: 'medium',
        },
      ],
    });
    expect(result.data.spec?.acceptanceCriteria).toEqual([
      {
        id: 'AC-1',
        statement: 'Users can log in with a valid refresh token.',
        executableChecks: [],
      },
      {
        id: 'AC-2',
        statement: 'Expired tokens are rejected.',
        executableChecks: [
          {
            id: 'AC-2-check-1',
            command: 'pnpm vitest run src/auth/token.test.ts',
            expectedExitCodes: [0],
            kind: 'unit',
          },
          {
            id: 'AC-2-check-2',
            command: 'pnpm vitest run src/auth/middleware.test.ts',
            expectedExitCodes: [0, 1],
            kind: 'integration',
          },
        ],
      },
    ]);
    expect(result.data.spec?.acceptanceCriteriaCount).toBe(2);
    expect(result.data.spec).not.toHaveProperty('decisionSummaries');
  });

  it('looks up Engineering Spec rows with local-db canonical work item ids', async () => {
    mockLocalDbProject();
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_42',
      externalId: '42',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });

    const result = await getIssueSpec('test-proj', '42');

    expect(result.ok).toBe(true);
    expect(getEngineeringSpec).toHaveBeenCalledWith('test-proj', 'wi_local_42');
  });
});

describe('transitionIssue — validation', () => {
  it('returns 400 when from is missing', async () => {
    const result = await transitionIssue('proj', '1', null, 'factory:triaging');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when from is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'not-a-state', 'factory:triaging');
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringMatching(/invalid.*from/i),
    });
  });

  it('returns 400 when to is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'not-a-state');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 422 when transition is illegal', async () => {
    vi.mocked(isLegalTransition).mockReturnValueOnce(false);
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:done');
    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await transitionIssue('unknown', '1', 'factory:triaging', 'factory:accepted');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('emits state.transitioned event on success', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:accepted');
    expect(result.ok).toBe(true);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });

  it('wraps direct manual transitions in a resolved manual_override intervention', async () => {
    const result = await transitionIssue(
      'proj-manual-override',
      '777',
      'factory:triaging',
      'factory:accepted',
    );

    expect(result.ok).toBe(true);
    const interventions = listInterventions({
      projectId: 'proj-manual-override',
      workItemId: 'github:owner/repo#777',
    });
    expect(interventions).toHaveLength(1);
    expect(interventions[0]).toMatchObject({
      interventionType: 'manual_override',
      status: 'RESOLVED',
      decidedActionType: 'manual_transition',
    });
    expect(listInterventionEvents(interventions[0].id).map((event) => event.eventType)).toEqual([
      'open',
      'decide',
      'markApplying',
      'recordApplicationResult',
      'verify',
      'resolve',
    ]);
  });

  it('attaches active discover session metadata to manual gate-pending → grilling transitions', async () => {
    const discoverSessionId = 'discover-session-manual-resume';
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj-manual-grill',
        workItemId: 'github:owner/repo#888',
        kind: 'grill.question-posted',
        runId: 'workflow-1',
        payload: { discoverSessionId },
        createdAt: '2026-05-22T00:00:00Z',
      },
    ]);

    const result = await transitionIssue(
      'proj-manual-grill',
      '888',
      'factory:gate-pending',
      'factory:grilling',
    );

    expect(result.ok).toBe(true);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state.transitioned',
        payload: expect.objectContaining({ discoverSessionId }),
      }),
    );
    const interventions = listInterventions({
      projectId: 'proj-manual-grill',
      workItemId: 'github:owner/repo#888',
    });
    expect(interventions[0].decidedActionPayload).toMatchObject({ discoverSessionId });
    expect(interventions[0].applicationResult).toMatchObject({
      result: { discoverSessionId },
    });
    const events = listInterventionEvents(interventions[0].id);
    expect(events[0].payload).toMatchObject({ evidence: { discoverSessionId } });
  });

  it('supersedes stale active interventions when a manual transition archives the issue', async () => {
    const stale = open({
      projectId: 'proj-manual-archive-cleanup',
      workItemId: 'github:owner/repo#899',
      interventionType: 'needs_human',
      title: 'Issue moved to needs-human',
      reason: 'The lifecycle state requires operator intervention.',
      rootCauseSignature:
        'proj-manual-archive-cleanup|github:owner/repo#899|state.transitioned|factory:dev-ready|factory:needs-human|',
      sourceEventId: 51107,
      actor: 'projector',
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    const result = await transitionIssue(
      'proj-manual-archive-cleanup',
      '899',
      'factory:needs-human',
      'factory:archived',
    );

    expect(result.ok).toBe(true);
    const interventions = listInterventions({
      projectId: 'proj-manual-archive-cleanup',
      workItemId: 'github:owner/repo#899',
    });
    const staleAfter = interventions.find(
      (intervention) => intervention.id === stale.intervention.id,
    );
    const manual = interventions.find(
      (intervention) => intervention.interventionType === 'manual_override',
    );
    expect(staleAfter).toMatchObject({ status: 'SUPERSEDED' });
    expect(manual).toMatchObject({ status: 'RESOLVED' });
    expect(listInterventionEvents(stale.intervention.id).map((event) => event.eventType)).toEqual([
      'open',
      'supersede',
    ]);
  });
});

describe('getIssueLegalTargets', () => {
  it('returns server-derived legal targets for the issue state', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'github:owner/repo#1',
      state: 'factory:triaging',
      type: 'chore',
    });
    vi.mocked(legalTargets).mockReturnValueOnce(['factory:accepted', 'factory:rejected']);

    const result = await getIssueLegalTargets('proj', '1');

    expect(result).toEqual({
      ok: true,
      data: {
        from: 'factory:triaging',
        legalTargets: ['factory:accepted', 'factory:rejected'],
      },
    });
  });

  it('filters type-specific targets on the server', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'github:owner/repo#1',
      state: 'factory:accepted',
      type: 'bug',
    });
    vi.mocked(legalTargets).mockReturnValueOnce([
      'factory:framing',
      'factory:grilling',
      'factory:investigating',
      'factory:dev-ready',
      'factory:research-pending',
    ]);

    const result = await getIssueLegalTargets('proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        from: 'factory:accepted',
        legalTargets: ['factory:investigating', 'factory:dev-ready'],
      },
    });
  });
});

describe('commentOnIssue — validation', () => {
  it('returns 400 when body is empty', async () => {
    const result = await commentOnIssue('proj', '1', '');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when body is whitespace-only', async () => {
    const result = await commentOnIssue('proj', '1', '   ');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await commentOnIssue('unknown', '1', 'hello');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('posts comment and emits event on success', async () => {
    const result = await commentOnIssue('proj', '1', 'Great idea');
    expect(result.ok).toBe(true);
    expect(mockSource.comment).toHaveBeenCalledWith('github:owner/repo#1', 'Great idea');
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual.action' }),
    );
  });

  it('posts comments against local-db canonical work item ids', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_1',
      externalId: '1',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });

    const result = await commentOnIssue('proj', '1', 'Local comment');

    expect(result.ok).toBe(true);
    expect(mockSource.comment).toHaveBeenCalledWith('wi_local_1', 'Local comment');
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 'wi_local_1' }),
    );
  });
});

describe('setIssueLabel — validation', () => {
  it('returns 400 for unknown group', async () => {
    const result = await setIssueLabel('proj', '1', 'milestone', 'foo');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid type value', async () => {
    const result = await setIssueLabel('proj', '1', 'type', 'epic');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns ok for valid type:bug', async () => {
    const result = await setIssueLabel('proj', '1', 'type', 'bug');
    expect(result.ok).toBe(true);
  });

  it('returns 400 for invalid priority value', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'urgent');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid schedule value', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'next');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await setIssueLabel('unknown', '1', 'priority', 'high');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns ok for valid priority:high', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'high');
    expect(result.ok).toBe(true);
  });

  it('returns ok for valid schedule:current', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'current');
    expect(result.ok).toBe(true);
  });

  it('accepts schedule:blocked-by and writes the correct label (#202)', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'blocked-by');
    expect(result.ok).toBe(true);
    expect(mockSource.setLabelInGroup).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'schedule',
      'blocked-by',
    );
  });

  it('translates UI schedule:backlog to canonical schedule:next at the boundary', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'backlog');
    expect(result.ok).toBe(true);
    expect(mockSource.setLabelInGroup).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'schedule',
      'next',
    );
  });

  it('translates UI schedule:icebox to canonical schedule:later at the boundary', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'icebox');
    expect(result.ok).toBe(true);
    expect(mockSource.setLabelInGroup).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'schedule',
      'later',
    );
  });

  it('writes grouped labels against local-db canonical work item ids', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_1',
      externalId: '1',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });

    const result = await setIssueLabel('proj', '1', 'priority', 'high');

    expect(result.ok).toBe(true);
    expect(mockSource.setLabelInGroup).toHaveBeenCalledWith('wi_local_1', 'priority', 'high');
  });
});

describe('listIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listIssues('unknown');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('calls listOpenWork with no milestone when resolveActiveMilestone returns null', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: null,
      source: 'github-default',
    });
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listIssues('proj');
    expect(mockSource.listOpenWork).toHaveBeenCalledWith(undefined);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
  });

  it('calls listOpenWork with milestone number when resolveActiveMilestone returns one', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 10,
      source: 'config',
    });
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#42' }]);
    const result = await listIssues('proj');
    expect(mockSource.listOpenWork).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#42' }] } });
  });

  it('two projects with different active milestones produce independent filtered sets', async () => {
    const sourceA = {
      ...mockSource,
      listOpenWork: vi.fn().mockResolvedValue([{ id: 'github:owner/repo#1', externalId: '1' }]),
    };
    const sourceB = {
      ...mockSource,
      listOpenWork: vi.fn().mockResolvedValue([{ id: 'github:owner/repo#99', externalId: '99' }]),
    };
    vi.mocked(getSourceForSlug)
      .mockResolvedValueOnce(sourceA as never)
      .mockResolvedValueOnce(sourceB as never);
    vi.mocked(resolveActiveMilestone)
      .mockResolvedValueOnce({ milestoneNumber: 10, source: 'config' })
      .mockResolvedValueOnce({ milestoneNumber: 5, source: 'config' });

    const [r1, r2] = await Promise.all([listIssues('proj-a'), listIssues('proj-b')]);

    expect(sourceA.listOpenWork).toHaveBeenCalledWith(10);
    expect(sourceB.listOpenWork).toHaveBeenCalledWith(5);
    expect(r1).toMatchObject({ ok: true });
    expect(r2).toMatchObject({ ok: true });
    const items1 = (r1 as { ok: true; data: { items: { id: string }[] } }).data.items;
    const items2 = (r2 as { ok: true; data: { items: { id: string }[] } }).data.items;
    expect(items1.map((i) => i.id)).not.toEqual(items2.map((i) => i.id));
  });
});

describe('getIssue', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getIssue('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('enriches the issue with durable agent pipeline timestamps', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-started',
          payload: { skill: 'triage' },
          runId: 'triage-run',
          personaId: null,
          createdAt: '2026-05-28T08:10:59Z',
        },
        {
          id: 2,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'review.completed',
          payload: {},
          runId: 'review-run',
          personaId: null,
          createdAt: '2026-05-28T08:28:10Z',
        },
        {
          id: 3,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'retrospective.completed',
          payload: {},
          runId: 'retro-run',
          personaId: null,
          createdAt: '2026-05-28T10:43:26Z',
        },
      ]);

    const result = await getIssue('proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        item: {
          pipelineStartedAt: '2026-05-28T08:10:59Z',
          pipelineCompletedAt: '2026-05-28T08:28:10Z',
        },
      },
    });
    expect(eventStore.replay).toHaveBeenLastCalledWith({
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
    });
  });

  it('excludes hidden runtime skill runs from pipelineStartedAt', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-started',
          payload: { skill: 'intervention-proposer' },
          runId: 'intervention-run',
          personaId: null,
          createdAt: '2026-05-28T08:00:00Z',
        },
        {
          id: 2,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-started',
          payload: { skill: 'triage' },
          runId: 'triage-run',
          personaId: null,
          createdAt: '2026-05-28T08:10:59Z',
        },
        {
          id: 3,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'review.completed',
          payload: {},
          runId: 'review-run',
          personaId: null,
          createdAt: '2026-05-28T08:28:10Z',
        },
      ]);

    const result = await getIssue('proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: { item: { pipelineStartedAt: '2026-05-28T08:10:59Z' } },
    });
  });

  it('sets pipelineCompletedAt from agent.run-failed when no review completes', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-started',
          payload: { skill: 'triage' },
          runId: 'triage-run',
          personaId: null,
          createdAt: '2026-05-28T08:10:59Z',
        },
        {
          id: 2,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-failed',
          payload: { error: 'timeout' },
          runId: 'triage-run',
          personaId: null,
          createdAt: '2026-05-28T08:20:00Z',
        },
      ]);

    const result = await getIssue('proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        item: {
          pipelineStartedAt: '2026-05-28T08:10:59Z',
          pipelineCompletedAt: '2026-05-28T08:20:00Z',
        },
      },
    });
  });

  it('does not set pipelineCompletedAt from a needs-fix review', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'agent.run-started',
          payload: { skill: 'triage' },
          runId: 'triage-run',
          personaId: null,
          createdAt: '2026-05-28T08:10:59Z',
        },
        {
          id: 2,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'review.completed',
          payload: { verdict: 'needs-fix' },
          runId: 'review-run',
          personaId: null,
          createdAt: '2026-05-28T08:28:10Z',
        },
      ]);

    const result = await getIssue('proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        item: {
          pipelineStartedAt: '2026-05-28T08:10:59Z',
          pipelineCompletedAt: null,
        },
      },
    });
  });
});

describe('getIssueWorktreeDiff (#185)', () => {
  beforeEach(() => {
    vi.mocked(eventStore.appendEvent).mockClear();
  });

  it('returns 400 for invalid slug (defence-in-depth)', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const result = await getIssueWorktreeDiff('../etc/hosts', '1');
    // The source-not-found guard fires first since `getSourceForSlug` returns
    // null for unknown slugs in this mocked setup. Either 404 or 400 satisfies
    // the defence-in-depth contract.
    expect(result.ok).toBe(false);
  });

  it('returns { diff: null } when no in-flight run exists for the issue', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([]);
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBeNull();
      expect(result.data.runId).toBeNull();
      expect(result.data.reason).toContain('no in-flight run');
    }
  });

  it('returns { diff: null } with the runId when worktree was cleaned up', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-cleaned-up-12345',
        payload: {},
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBeNull();
      expect(result.data.runId).toBe('run-cleaned-up-12345');
      expect(result.data.reason).toContain('worktree not found');
    }
  });

  it('git diff args exclude .claude/ directory', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.run-started',
        runId: 'run-live-aabbcc',
        payload: {},
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    vi.mocked(existsSync).mockImplementation((p) => String(p).includes('run-live-aabbcc'));
    vi.mocked(execFileSync).mockReturnValueOnce(
      'diff --git a/src/foo.ts b/src/foo.ts\n+added line' as never,
    );
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.diff).toContain('+added line');
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([':(exclude).claude/']),
      expect.any(Object),
    );
  });

  it('filters generated package-store files from live worktree diffs', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.run-started',
        runId: 'run-live-store',
        payload: {},
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    vi.mocked(existsSync).mockImplementation((p) => String(p).includes('run-live-store'));
    vi.mocked(execFileSync).mockReturnValueOnce(
      [
        'diff --git a/.pnpm-store/v10/files/aa/hash b/.pnpm-store/v10/files/aa/hash',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/.pnpm-store/v10/files/aa/hash',
        '@@ -0,0 +1 @@',
        '+generated dependency cache',
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n') as never,
    );

    const result = await getIssueWorktreeDiff('proj', '1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).not.toContain('.pnpm-store');
      expect(result.data.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    }
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([':(exclude).pnpm-store/', ':(exclude)node_modules/']),
      expect.any(Object),
    );
  });

  it('fetches diff from GitHub PR when worktree is gone and pr.opened event has prNumber', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    process.env.GITHUB_TOKEN = 'ghp_test';
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-pr-gone-99887',
        payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42' },
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('diff --git a/src/bar.ts b/src/bar.ts\n+github line'),
    });
    const result = await getIssueWorktreeDiff('proj', '1', {
      fetchImpl: mockFetch as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBe('diff --git a/src/bar.ts b/src/bar.ts\n+github line');
      expect(result.data.runId).toBe('run-pr-gone-99887');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github.v3.diff' }),
      }),
    );
  });

  it('filters generated package-store files from GitHub PR diffs', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    process.env.GITHUB_TOKEN = 'ghp_test';
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-pr-gone-store',
        payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42' },
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          [
            'diff --git a/.pnpm-store/v10/files/aa/hash b/.pnpm-store/v10/files/aa/hash',
            '+generated dependency cache',
            'diff --git a/apps/server/src/foo.ts b/apps/server/src/foo.ts',
            '+real change',
          ].join('\n'),
        ),
    });

    const result = await getIssueWorktreeDiff('proj', '1', {
      fetchImpl: mockFetch as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).not.toContain('.pnpm-store');
      expect(result.data.diff).toContain('apps/server/src/foo.ts');
    }
  });
});

describe('approveIssue / rejectIssue (#186)', () => {
  beforeEach(() => {
    vi.mocked(eventStore.appendEvent).mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  it('rejectIssue rejects empty / whitespace reason with 400', async () => {
    const { rejectIssue } = await import('./service.js');
    expect(await rejectIssue('proj', '1', '')).toMatchObject({ ok: false, status: 400 });
    expect(await rejectIssue('proj', '1', '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await rejectIssue('proj', '1', undefined)).toMatchObject({ ok: false, status: 400 });
  });

  it('rejectIssue posts a comment, emits gate.rejected, transitions to needs-fix', async () => {
    const { rejectIssue } = await import('./service.js');
    const result = await rejectIssue('proj', '1', 'tests are flaky');
    expect(result).toMatchObject({ ok: true });
    expect(mockSource.comment).toHaveBeenCalledWith(
      'github:owner/repo#1',
      expect.stringContaining('tests are flaky'),
    );
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'factory:approved',
      'factory:needs-fix',
    );
    const rejected = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'gate.rejected');
    expect(rejected).toBeDefined();
  });

  it('rejectIssue carries intervention metadata on downstream events', async () => {
    const { rejectIssue } = await import('./service.js');
    const result = await rejectIssue('proj', '1', 'tests are flaky', {
      intervention: { id: 'i-reject', correlationId: 'c-reject' },
    });
    expect(result).toMatchObject({ ok: true });

    const rejected = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'gate.rejected')?.[0];
    expect(rejected?.payload).toEqual(
      expect.objectContaining({
        interventionId: 'i-reject',
        causedByInterventionId: 'i-reject',
        correlationId: 'c-reject',
      }),
    );
  });

  it('approveIssue rejects when no pr.opened event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('approveIssue merges via the connector and transitions to factory:retrospecting', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: { prNumber: 99, prUrl: 'u', branch: 'b' },
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);

    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc1234', merged: true });

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', {
      mergePRImpl,
      intervention: { id: 'i-approve', correlationId: 'c-approve' },
    });
    expect(result).toMatchObject({ ok: true, data: { sha: 'abc1234', prNumber: 99 } });
    expect(mergePRImpl).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', prNumber: 99 }),
    );
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'factory:approved',
      'factory:retrospecting',
    );
    const approved = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'gate.approved');
    expect(approved).toBeDefined();
    expect(approved?.[0].payload).toEqual(
      expect.objectContaining({
        interventionId: 'i-approve',
        causedByInterventionId: 'i-approve',
        correlationId: 'c-approve',
      }),
    );
    const merged = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'pr.merged');
    expect(merged).toBeDefined();
  });

  it('approveIssue cleans up the dev worktree using devRunId from pr.opened after merge', async () => {
    const prOpenedEvent = {
      id: 1,
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
      kind: 'pr.opened',
      runId: 'dev-run-123',
      payload: {
        prNumber: 99,
        prUrl: 'u',
        branch: 'b',
        worktreePath: '/wt/dev-run-123',
        devRunId: 'dev-run-123',
        pipelineRunId: 'pipeline-run-123',
      },
      createdAt: '2026-05-02T22:00:00Z',
    };
    vi.mocked(eventStore.replay).mockReturnValue([prOpenedEvent] as never);
    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc1234', merged: true });

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', { mergePRImpl });

    expect(result).toMatchObject({ ok: true });
    expect(cleanupWorktree).toHaveBeenCalledWith('dev-run-123');
  });

  it('approveIssue runs merge-decision and emits its result for a legacy pipelineRunId', async () => {
    const prOpenedEvent = {
      id: 1,
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
      kind: 'pr.opened',
      runId: 'legacy-dev-run',
      payload: {
        prNumber: 99,
        prUrl: 'u',
        branch: 'b',
        worktreePath: '/wt/legacy-dev-run',
        devRunId: 'legacy-dev-run',
        pipelineRunId: 'legacy-dev-run',
      },
      createdAt: '2026-05-02T22:00:00Z',
    };
    vi.mocked(eventStore.replay).mockReturnValue([prOpenedEvent] as never);
    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc1234', merged: true });
    const runMergeDecisionImpl = vi.fn().mockReturnValueOnce({
      passed: true,
      score: 100,
      reason: 'score-only-pass',
    });

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', {
      mergePRImpl,
      runMergeDecisionImpl,
      pipelineEnabledOverride: true,
    });

    expect(result).toMatchObject({ ok: true });
    expect(runMergeDecisionImpl).toHaveBeenCalledWith({
      pipelineRunId: 'legacy-dev-run',
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
    });
    const mergeDecision = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'merge-decision.completed');
    expect(mergeDecision?.[0].payload).toMatchObject({
      passed: true,
      score: 100,
      reason: 'score-only-pass',
      pipelineRunId: 'legacy-dev-run',
      prNumber: 99,
    });
  });

  it('approveIssue returns 409 and transitions to merge-conflict when GitHub 405', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42', branch: 'b' },
        createdAt: '2026-05-05T10:00:00Z',
      },
    ] as never);

    const { MergeConflictError } = await import('@goose-hub/core/connectors/github/merge-pr.js');
    const mergePRImpl = vi.fn().mockRejectedValueOnce(new MergeConflictError(42));

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', { mergePRImpl });

    expect(result).toMatchObject({ ok: false, status: 409, error: 'merge-conflict' });
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      '1',
      'factory:approved',
      'factory:merge-conflict',
    );
    const conflictEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'merge.conflict');
    expect(conflictEvent).toBeDefined();
  });
});

describe('getIssueEvents', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns events in reverse order (newest first)', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.spawned',
        payload: {},
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        kind: 'agent.terminated',
        payload: {},
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01T00:00:01Z',
      },
    ] as never);
    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.data.events as Array<{ id: number }>;
      expect(events[0].id).toBe(2);
      expect(events[1].id).toBe(1);
    }
  });

  it('queries timeline events with local-db canonical work item ids', async () => {
    mockLocalDbProject();
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_1',
      externalId: '1',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);

    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1');

    expect(result.ok).toBe(true);
    expect(eventStore.replay).toHaveBeenCalledWith({
      projectId: 'proj',
      workItemId: 'wi_local_1',
    });
  });

  it('excludes historical Hub Chat events from issue timelines', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'chat.agent-message',
        payload: { conversationId: 'conv_1' },
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        kind: 'agent.run-started',
        payload: { skill: 'hub-chat', runId: 'chat_1' },
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        createdAt: '2026-01-01T00:00:01Z',
      },
      {
        id: 3,
        kind: 'agent.run-started',
        payload: { skill: 'investigate', runId: 'run_1' },
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        createdAt: '2026-01-01T00:00:02Z',
      },
    ] as never);

    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.data.events as Array<{ id: number; kind: string }>;
      expect(events.map((event) => event.id)).toEqual([3]);
      expect(events.map((event) => event.kind)).toEqual(['agent.run-started']);
    }
  });

  it('keeps paginated issue timelines full after filtering Hub Chat rows', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce([
        {
          id: 10,
          kind: 'chat.agent-message',
          payload: { conversationId: 'conv_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:10Z',
        },
        {
          id: 9,
          kind: 'agent.run-completed',
          payload: { skill: 'hub-chat', runId: 'chat_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:09Z',
        },
      ] as never)
      .mockReturnValueOnce([
        {
          id: 8,
          kind: 'agent.run-started',
          payload: { skill: 'investigate', runId: 'run_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:08Z',
        },
        {
          id: 7,
          kind: 'state.transitioned',
          payload: { to: 'factory:triaging' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:07Z',
        },
      ] as never);

    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1', { limit: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.data.events as Array<{ id: number }>;
      expect(events.map((event) => event.id)).toEqual([8]);
      expect(result.data.hasMore).toBe(true);
    }
  });

  it('keeps after-cursor backfill pages full after filtering hidden rows', async () => {
    vi.mocked(eventStore.replay)
      .mockReturnValueOnce(
        Array.from({ length: 100 }, (_, index) => ({
          id: 11 + index,
          kind: 'chat.agent-message',
          payload: { conversationId: 'conv_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:11Z',
        })) as never,
      )
      .mockReturnValueOnce([
        {
          id: 111,
          kind: 'state.transitioned',
          payload: { to: 'factory:triaging' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:13Z',
        },
        {
          id: 112,
          kind: 'agent.run-started',
          payload: { skill: 'investigate', runId: 'run_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:14Z',
        },
        {
          id: 113,
          kind: 'agent.run-completed',
          payload: { skill: 'investigate', runId: 'run_1' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          createdAt: '2026-01-01T00:00:15Z',
        },
      ] as never);

    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1', { limit: 1, after: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.data.events as Array<{ id: number }>;
      expect(events.map((event) => event.id)).toEqual([111]);
      expect(result.data.hasMore).toBe(true);
      expect(eventStore.replay).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ sinceId: 110 }),
      );
    }
  });
});

describe('getIssueArtifact', () => {
  const artifact = {
    id: 1,
    artifactKey: 'pr-diff:abc',
    projectId: 'proj',
    workItemId: 'github:owner/repo#1',
    runId: 'run-1',
    kind: 'pr-diff',
    summary: '1 changed file',
    payload: 'diff',
    bytes: 4,
    createdAt: '2026-05-14T00:00:00Z',
    expiresAt: null,
  };

  it('returns artifact payload when project and issue association match', async () => {
    vi.mocked(getArtifact).mockReturnValueOnce(artifact);

    const result = await getIssueArtifact('proj', '1', 'pr-diff:abc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.artifact).toEqual({
        artifactKey: 'pr-diff:abc',
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        runId: 'run-1',
        kind: 'pr-diff',
        summary: '1 changed file',
        bytes: 4,
        createdAt: '2026-05-14T00:00:00Z',
        expiresAt: null,
        payload: 'diff',
      });
    }
  });

  it('rejects artifacts from another project', async () => {
    vi.mocked(getArtifact).mockReturnValueOnce({ ...artifact, projectId: 'other' });

    const result = await getIssueArtifact('proj', '1', 'pr-diff:abc');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'artifact not found' });
  });

  it('rejects artifacts from another issue', async () => {
    vi.mocked(getArtifact).mockReturnValueOnce({
      ...artifact,
      workItemId: 'github:owner/repo#2',
    });

    const result = await getIssueArtifact('proj', '1', 'pr-diff:abc');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'artifact not found' });
  });

  it('returns 404 for unknown artifact keys', async () => {
    vi.mocked(getArtifact).mockReturnValueOnce(null);

    const result = await getIssueArtifact('proj', '1', 'missing');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'artifact not found' });
  });

  it('does not let artifact key tampering bypass association checks', async () => {
    vi.mocked(getArtifact).mockReturnValueOnce({
      ...artifact,
      artifactKey: 'pr-diff:tampered',
      projectId: 'other',
      workItemId: 'github:owner/repo#999',
    });

    const result = await getIssueArtifact('proj', '1', 'pr-diff:tampered');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'artifact not found' });
  });

  it('returns 404 when project is unknown', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);

    const result = await getIssueArtifact('unknown', '1', 'pr-diff:abc');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'project not found' });
  });
});

describe('getIssueComments', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueComments } = await import('./service.js');
    const result = await getIssueComments('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns comments from source', async () => {
    const comments = [{ id: 1, body: 'hello' }];
    mockSource.listComments.mockResolvedValueOnce(comments);
    const { getIssueComments } = await import('./service.js');
    const result = await getIssueComments('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.comments).toEqual(comments);
    }
  });

  it('lists comments by local-db canonical work item id', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_1',
      externalId: '1',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });
    const comments = [{ id: 1, body: 'hello' }];
    mockSource.listComments.mockResolvedValueOnce(comments);

    const { getIssueComments } = await import('./service.js');
    const result = await getIssueComments('proj', '1');

    expect(result.ok).toBe(true);
    expect(mockSource.listComments).toHaveBeenCalledWith('wi_local_1');
  });
});

describe('getIssueTriage', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns triage: null when no triage event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.triage).toBeNull();
    }
  });

  it('returns triage dto when agent.triage-complete event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.triage-complete',
        runId: null,
        payload: {
          triage: { type: 'bug', priority: 'high' },
          repoMatch: {
            candidates: [{ repo: 'owner/repo', confidence: 90, evidence: 'match', tier: 1 }],
          },
        },
        createdAt: '2026-01-01T00:00:00Z',
      },
    ] as never);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.type).toBe('bug');
      expect(triage.priority).toBe('high');
      expect(triage.overrideRepo).toBeNull();
    }
  });

  it('returns triage with overrideRepo when agent.repo-override event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.triage-complete',
        runId: null,
        payload: {
          triage: { type: 'feature', priority: 'medium' },
          repoMatch: { candidates: [] },
        },
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.repo-override',
        runId: null,
        payload: { repo: 'owner/other-repo' },
        createdAt: '2026-01-01T00:00:01Z',
      },
    ] as never);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.overrideRepo).toBe('owner/other-repo');
    }
  });
});

describe('setIssueMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('unknown', '1', 5);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('calls setMilestone and emits manual.action event on success', async () => {
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('proj', '1', 3);
    expect(result.ok).toBe(true);
    expect(mockSource.setMilestone).toHaveBeenCalledWith('github:owner/repo#1', 3);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual.action' }),
    );
  });

  it('sets milestone using local-db canonical work item ids', async () => {
    mockSource.getItem.mockResolvedValueOnce({
      id: 'wi_local_1',
      externalId: '1',
      repoRef: 'owner/repo',
      state: 'factory:triaging',
      type: 'feature',
    });

    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('proj', '1', 3);

    expect(result.ok).toBe(true);
    expect(mockSource.setMilestone).toHaveBeenCalledWith('wi_local_1', 3);
  });

  it('can set milestone to null to clear it', async () => {
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('proj', '1', null);
    expect(result.ok).toBe(true);
    expect(mockSource.setMilestone).toHaveBeenCalledWith('github:owner/repo#1', null);
  });
});

describe('approveIssue — edge cases', () => {
  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 500 when pr.opened event has no prNumber', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: {}, // no prNumber
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1');
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: expect.stringContaining('prNumber'),
    });
  });

  it('returns 500 when GITHUB_TOKEN is not set', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '';
    try {
      vi.mocked(eventStore.replay).mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'pr.opened',
          runId: 'run-1',
          payload: { prNumber: 5 },
          createdAt: '2026-05-02T22:00:00Z',
        },
      ] as never);
      const { approveIssue } = await import('./service.js');
      const result = await approveIssue('proj', '1');
      expect(result).toMatchObject({
        ok: false,
        status: 500,
        error: expect.stringContaining('GITHUB_TOKEN'),
      });
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
    }
  });
});

describe('overrideIssueRepo — body (requires repos.md mock)', () => {
  it('returns 404 when source not found after valid slug', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await overrideIssueRepo('valid-slug', '1', 'owner/repo');
    // source is null so returns 404
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 400 when repo is not in the allowlist', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/allowed-repo]\n' as never);
    const result = await overrideIssueRepo('proj', '1', 'owner/not-allowed');
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining('not in allowlist'),
    });
  });

  it('returns triage null when repo is allowed but no triage event exists', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/repo]\n' as never);
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const result = await overrideIssueRepo('proj', '1', 'owner/repo');
    expect(result).toMatchObject({ ok: true, data: { triage: null } });
  });

  it('returns triage dto when repo is allowed and triage event exists', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/repo]\n' as never);
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.triage-complete',
        payload: {
          triage: { type: 'bug', priority: 'high' },
          repoMatch: { candidates: [] },
        },
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01',
      },
    ] as never);
    const result = await overrideIssueRepo('proj', '1', 'owner/repo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.type).toBe('bug');
      expect(triage.overrideRepo).toBe('owner/repo');
    }
  });
});

describe('overrideIssueRepo (#201 slug guard)', () => {
  it('rejects path-traversal slug with 400', async () => {
    const result = await overrideIssueRepo('../etc/hosts', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
    // Importantly, getSourceForSlug is never called for an invalid slug.
    expect(getSourceForSlug).not.toHaveBeenCalled();
  });

  it('rejects slug with slashes with 400', async () => {
    const result = await overrideIssueRepo('foo/bar', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
  });

  it('rejects empty slug with 400', async () => {
    const result = await overrideIssueRepo('', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
  });

  it('still rejects when repo is not provided (repo guard fires first)', async () => {
    const result = await overrideIssueRepo('valid-slug', '1', undefined);
    expect(result).toMatchObject({ ok: false, error: 'repo is required', status: 400 });
  });
});
