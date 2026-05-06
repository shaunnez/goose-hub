import { describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import type { AgentConfig } from '../types.js';
import { selectModel } from './model-router.js';

const appendEvent = vi.fn().mockReturnValue({ id: 1 });

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => appendEvent(...(args as [unknown])),
  },
}));

const mockAgentConfig = {
  runtime: 'claude-cli' as const,
  rolesModels: {
    triager: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    developer: {
      primary: 'sonnet' as const,
      fallback: 'haiku' as const,
      advisor: 'sonnet' as const,
    },
    qa: { primary: 'haiku' as const, fallback: null, advisor: null },
    reviewer: { primary: 'haiku' as const, fallback: null, advisor: null },
    griller: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    'prd-writer': { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    decomposer: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    investigator: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    retrospector: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
    researcher: { primary: 'sonnet' as const, fallback: 'haiku' as const, advisor: null },
  },
  fallbackPolicy: {},
  toolAllowlists: {},
  advisorMode: {
    enabled: false,
    triggerOn: { priorities: [] },
    maxAdvisorBudgetUsd: 0,
    disableInAutonomous: false,
  },
  retrospectivePolicy: { defaultTier: 'light' as const, deepTriggers: [] },
  modelRouter: { overrides: {} },
} as unknown as AgentConfig;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#1',
    externalId: '1',
    repoRef: 'owner/repo',
    title: 'Test issue',
    body: '## Acceptance criteria\n- [ ] First item\n- [ ] Second item',
    type: 'feature',
    priority: 'medium',
    mode: 'interactive',
    state: 'factory:triaging',
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    authorIsOwner: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('selectModel', () => {
  describe('static policy — bugs', () => {
    it('returns haiku for bug type', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('haiku');
      expect(result.reason).toContain('bug');
    });
  });

  describe('static policy — features', () => {
    it('returns sonnet for small feature (AC < 5, body < 1500)', () => {
      appendEvent.mockClear();
      const body = '- [ ] Item 1\n- [ ] Item 2\n'.repeat(5); // ~60 chars
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('sonnet');
      expect(result.reason).toContain('feature');
    });

    it('returns sonnet with "large-feature" reason for feature with AC >= 5', () => {
      appendEvent.mockClear();
      const body = '- [ ] Item 1\n- [ ] Item 2\n- [ ] Item 3\n- [ ] Item 4\n- [ ] Item 5';
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('sonnet');
      expect(result.reason).toBe('large-feature');
    });

    it('returns sonnet with "large-feature" reason for feature with body >= 1500', () => {
      appendEvent.mockClear();
      const body = `${'x'.repeat(1500)}- [ ] Item`;
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('sonnet');
      expect(result.reason).toBe('large-feature');
    });
  });

  describe('static policy — chores', () => {
    it('returns haiku for chore type', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ type: 'chore' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('haiku');
      expect(result.reason).toContain('chore');
    });
  });

  describe('static policy — priorities', () => {
    it('returns sonnet for priority:high', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ priority: 'high' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('sonnet');
      expect(result.reason).toContain('high');
    });

    it('returns sonnet for priority:critical', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ priority: 'critical' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('sonnet');
      expect(result.reason).toContain('critical');
    });
  });

  describe('holdout role bypass', () => {
    it('returns qa role primary tier for qa role', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', priority: 'critical' }),
        role: 'qa',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      // qa's primary tier is haiku, should not escalate despite feature + critical
      expect(result.tier).toBe('haiku');
      expect(result.reason).toContain('qa');
    });

    it('returns reviewer role primary tier for reviewer role', () => {
      appendEvent.mockClear();
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', priority: 'critical' }),
        role: 'reviewer',
        projectId: 'p',
        agentConfig: mockAgentConfig,
        runId: 'run-1',
      });
      expect(result.tier).toBe('haiku');
      expect(result.reason).toContain('reviewer');
    });
  });

  describe('overrides', () => {
    it('applies project-level override by role', () => {
      appendEvent.mockClear();
      const configWithOverride = {
        ...mockAgentConfig,
        modelRouter: {
          overrides: {
            developer: 'opus' as const,
          },
        },
      };
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: configWithOverride,
        runId: 'run-1',
      });
      expect(result.tier).toBe('opus');
      expect(result.reason).toContain('override');
    });

    it('applies role+labelSet override if key matches', () => {
      appendEvent.mockClear();
      const configWithOverride = {
        ...mockAgentConfig,
        modelRouter: {
          overrides: {
            'developer+feature': 'opus' as const,
          },
        },
      };
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature' }),
        role: 'developer',
        projectId: 'p',
        agentConfig: configWithOverride,
        runId: 'run-1',
      });
      expect(result.tier).toBe('opus');
      expect(result.reason).toContain('override');
    });
  });

  describe('agent.model-selected event', () => {
    it('emits event with correct payload', () => {
      appendEvent.mockClear();
      selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'proj-1',
        agentConfig: mockAgentConfig,
        runId: 'run-123',
      });
      expect(appendEvent).toHaveBeenCalledOnce();
      const [call] = appendEvent.mock.calls;
      const [input] = call as [unknown];
      expect(input).toMatchObject({
        projectId: 'proj-1',
        kind: 'agent.model-selected',
        runId: 'run-123',
      });
      const typedInput = input as Record<string, unknown>;
      const payload = typedInput.payload;
      expect(payload).toMatchObject({
        role: 'developer',
        selectedTier: 'haiku',
        reason: expect.any(String),
      });
    });
  });
});

describe('model-router integration', () => {
  it('respects AgentConfig.rolesModels for holdout role primary tier', () => {
    appendEvent.mockClear();
    const customConfig = {
      ...mockAgentConfig,
      rolesModels: {
        ...mockAgentConfig.rolesModels,
        qa: { primary: 'opus' as const, fallback: null, advisor: null },
      },
    };

    const result = selectModel({
      workItem: makeWorkItem({ priority: 'critical' }),
      role: 'qa',
      projectId: 'p',
      agentConfig: customConfig,
      runId: 'r',
    });

    expect(result.tier).toBe('opus');
  });

  it('handles very long body text', () => {
    appendEvent.mockClear();
    const veryLongBody = 'x'.repeat(5000);
    const result = selectModel({
      workItem: makeWorkItem({ type: 'feature', body: veryLongBody }),
      role: 'developer',
      projectId: 'p',
      agentConfig: mockAgentConfig,
      runId: 'r',
    });

    expect(result.tier).toBe('sonnet');
    expect(result.reason).toBe('large-feature');
  });

  it('handles many acceptance criteria', () => {
    appendEvent.mockClear();
    const manyACs = Array(10).fill('- [ ] Item').join('\n');
    const result = selectModel({
      workItem: makeWorkItem({ type: 'feature', body: manyACs }),
      role: 'developer',
      projectId: 'p',
      agentConfig: mockAgentConfig,
      runId: 'r',
    });

    expect(result.tier).toBe('sonnet');
    expect(result.reason).toBe('large-feature');
  });

  it('counts mixed checkbox styles correctly', () => {
    appendEvent.mockClear();
    const mixedACs = `${Array(5).fill('- [ ] Item').join('\n')}\n- [x] Extra\n- [X] More`;
    const result = selectModel({
      workItem: makeWorkItem({ type: 'feature', body: mixedACs }),
      role: 'developer',
      projectId: 'p',
      agentConfig: mockAgentConfig,
      runId: 'r',
    });

    expect(result.tier).toBe('sonnet');
    expect(result.reason).toBe('large-feature');
  });

  it('gracefully handles missing modelRouter config', () => {
    appendEvent.mockClear();
    const minimalConfig = {
      ...mockAgentConfig,
      modelRouter: undefined,
    } as typeof mockAgentConfig;

    const result = selectModel({
      workItem: makeWorkItem({ type: 'bug' }),
      role: 'developer',
      projectId: 'p',
      agentConfig: minimalConfig,
      runId: 'r',
    });

    expect(result.tier).toBe('haiku');
    expect(result.reason).toBe('bug type');
  });
});
