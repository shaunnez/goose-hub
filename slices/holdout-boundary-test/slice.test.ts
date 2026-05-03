import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock eventStore before importing assembleSpawnContext
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn(),
  },
}));

import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';

const mockAppendEvent = vi.mocked(eventStore.appendEvent);

function makeHoldoutSpec(
  role: 'qa' | 'reviewer',
  context: Record<string, unknown>,
  allowlist: string[],
): AgentSpec {
  return {
    runId: `boundary-test-${crypto.randomUUID()}`,
    role,
    skill: role,
    context: { projectId: 'test-project', workItemId: 'test-item', ...context },
    contextAllowlist: allowlist,
    freshContext: true,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1 },
    personaId: `test-project/${role}/0`,
  };
}

describe('Holdout boundary test — deliberate injection attempts', () => {
  beforeEach(() => {
    mockAppendEvent.mockClear();
  });

  describe('QA role — devDecisionSummaries injection attempt', () => {
    it('devDecisionSummaries is absent from rendered XML', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'test' },
          devDecisionSummaries: ['SECRET: developer chose approach X because of Y constraint'],
        },
        ['workItem'],
      );

      const { contextXml } = assembleSpawnContext(spec);
      expect(contextXml).not.toContain('devDecisionSummaries');
      expect(contextXml).not.toContain('SECRET');
      expect(contextXml).not.toContain('developer chose approach');
    });

    it('devDecisionSummaries injection emits tool.violation event', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'test' },
          devDecisionSummaries: ['secret reasoning'],
        },
        ['workItem'],
      );

      assembleSpawnContext(spec);

      const violations = mockAppendEvent.mock.calls.filter(([e]) => e.kind === 'tool.violation');
      expect(violations.length).toBeGreaterThanOrEqual(1);
      const violationPayloads = violations.map(
        ([e]) => e.payload as { disallowedKey: string; role: string },
      );
      expect(violationPayloads.some((p) => p.disallowedKey === 'devDecisionSummaries')).toBe(true);
      expect(violationPayloads.every((p) => p.role === 'qa')).toBe(true);
    });

    it('runId is included in tool.violation event payload', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'test' },
          investigationFindings: 'leaked reasoning',
        },
        ['workItem'],
      );

      assembleSpawnContext(spec);

      const violation = mockAppendEvent.mock.calls.find(([e]) => e.kind === 'tool.violation');
      expect(violation).toBeDefined();
      const payload = violation?.[0].payload as { runId: string } | undefined;
      expect(payload?.runId).toBe(spec.runId);
    });
  });

  describe('QA role — multiple disallowed keys', () => {
    it('emits one tool.violation event per disallowed key', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'test' },
          devDecisionSummaries: ['secret 1'],
          investigationFindings: { keyFile: 'auth.ts' },
          advisorFeedback: 'internal advisor thoughts',
        },
        ['workItem'],
      );

      assembleSpawnContext(spec);

      const violations = mockAppendEvent.mock.calls.filter(([e]) => e.kind === 'tool.violation');
      expect(violations.length).toBe(3);
      const keys = violations.map(([e]) => (e.payload as { disallowedKey: string }).disallowedKey);
      expect(keys).toContain('devDecisionSummaries');
      expect(keys).toContain('investigationFindings');
      expect(keys).toContain('advisorFeedback');
    });

    it('allowed keys ARE present in XML', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'my test issue' },
          prDiff: '+foo bar',
          devDecisionSummaries: ['should not appear'],
        },
        ['workItem', 'prDiff'],
      );

      const { contextXml } = assembleSpawnContext(spec);
      expect(contextXml).toContain('workItem');
      expect(contextXml).toContain('prDiff');
      expect(contextXml).not.toContain('devDecisionSummaries');
    });
  });

  describe('Reviewer role — injection attempt', () => {
    it('devDecisionSummaries absent from Reviewer XML', () => {
      const spec = makeHoldoutSpec(
        'reviewer',
        {
          workItem: { title: 'test' },
          prDiff: '+foo',
          devDecisionSummaries: ['SECRET reviewer should not see this'],
        },
        ['workItem', 'prDiff', 'qaVerdict'],
      );

      const { contextXml } = assembleSpawnContext(spec);
      expect(contextXml).not.toContain('devDecisionSummaries');
      expect(contextXml).not.toContain('SECRET reviewer should not see this');
    });

    it('Reviewer injection emits tool.violation with role: reviewer', () => {
      const spec = makeHoldoutSpec(
        'reviewer',
        {
          workItem: { title: 'test' },
          devDecisionSummaries: ['reasoning'],
        },
        ['workItem', 'qaVerdict'],
      );

      assembleSpawnContext(spec);

      const violations = mockAppendEvent.mock.calls.filter(([e]) => e.kind === 'tool.violation');
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.every(([e]) => (e.payload as { role: string }).role === 'reviewer')).toBe(
        true,
      );
    });
  });

  describe('Non-holdout role — NO violation events', () => {
    it('developer role with unlisted keys does NOT emit tool.violation', () => {
      const spec: AgentSpec = {
        runId: 'dev-test',
        role: 'developer',
        skill: 'implement',
        context: {
          projectId: 'test-project',
          workItemId: 'test-item',
          workItem: { title: 'test' },
          advisorFeedback: 'some feedback',
          extraData: 'extra',
        },
        contextAllowlist: ['workItem'],
        freshContext: false,
        toolBundles: [],
        toolExtras: [],
        budgets: { maxTurns: 5, maxBudgetUsd: 0.1 },
        personaId: 'test-project/developer/0',
      };

      assembleSpawnContext(spec);

      const violations = mockAppendEvent.mock.calls.filter(([e]) => e.kind === 'tool.violation');
      expect(violations.length).toBe(0);
    });
  });

  describe('System keys — exempted from violation detection', () => {
    it('projectId and workItemId are NOT flagged as violations on holdout roles', () => {
      const spec = makeHoldoutSpec(
        'qa',
        {
          workItem: { title: 'test' },
        },
        ['workItem'], // projectId and workItemId NOT in allowlist — should NOT be violations
      );

      assembleSpawnContext(spec);

      const violations = mockAppendEvent.mock.calls.filter(([e]) => e.kind === 'tool.violation');
      const keys = violations.map(([e]) => (e.payload as { disallowedKey: string }).disallowedKey);
      expect(keys).not.toContain('projectId');
      expect(keys).not.toContain('workItemId');
    });
  });
});
