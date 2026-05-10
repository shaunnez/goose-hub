import {
  HOLDOUT_FORBIDDEN_KEYS,
  assembleSpawnContext,
  findHoldoutContextLeaks,
} from '@goose-hub/core/agent-runtime/context-assembly.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { ROLE_DEFAULTS } from '@goose-hub/core/agent-runtime/roles.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DevReviewFinding, DevReviewFindingSchema, DevReviewOutputSchema } from './schema.js';
import devReviewConfig, { DevReviewContextSchema } from './skill.config.js';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'tool.violation', payload: {} }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── skill.config.ts shape ────────────────────────────────────────────────────

describe('skills/dev-review skill.config', () => {
  it('declares provider: codex (M19.10 dispatcher routes to CodexCliRuntime)', () => {
    expect(devReviewConfig.provider).toBe('codex');
  });

  it('declares role dev-reviewer (registered, NOT a holdout)', () => {
    expect(devReviewConfig.role).toBe('dev-reviewer');
    expect(ROLE_DEFAULTS['dev-reviewer']).toBeDefined();
    expect(ROLE_DEFAULTS['dev-reviewer'].modelTier).toBe('sonnet');
  });

  it('uses fresh context — independent re-read of the diff', () => {
    expect(devReviewConfig.freshContext).toBe(true);
  });

  it('uses read-only tool bundle (no shell, no write)', () => {
    expect(devReviewConfig.toolBundles).toEqual(['read']);
  });

  it('contextAllowlist excludes any developer-reasoning keys', () => {
    const allowlist = devReviewConfig.contextAllowlist ?? [];
    expect(allowlist).not.toContain('advisorFeedback');
    expect(allowlist).not.toContain('decisionSummaries');
    expect(allowlist).not.toContain('investigationFindings');
    expect(allowlist).not.toContain('revisionPass');
  });

  it('contextSchema accepts a minimal valid input', () => {
    expect(() =>
      DevReviewContextSchema.parse({
        workItem: { title: 't', body: 'b', number: 1, priority: 'medium' },
        prDiff: 'diff --git a/x b/x',
      }),
    ).not.toThrow();
  });
});

// ─── role registration ────────────────────────────────────────────────────────

describe('dev-reviewer role registration', () => {
  it('is NOT in the holdout set (allows advisor-style use inside the dev cycle)', () => {
    // Role union is type-checked at compile time; this asserts the role is
    // present in the runtime defaults table without being a holdout.
    expect(ROLE_DEFAULTS['dev-reviewer']).toBeDefined();
    // Holdouts in the runtime are 'qa' and 'reviewer' — dev-reviewer is neither.
    expect(['qa', 'reviewer']).not.toContain('dev-reviewer');
  });

  it('has reasonable default budgets (sonnet, < 10 turns, ≤ $0.50)', () => {
    const d = ROLE_DEFAULTS['dev-reviewer'];
    expect(d.modelTier).toBe('sonnet');
    expect(d.budgets.maxTurns).toBeLessThanOrEqual(10);
    expect(d.budgets.maxBudgetUsd).toBeLessThanOrEqual(0.5);
  });
});

// ─── output schema enforcement ────────────────────────────────────────────────

describe('DevReviewOutputSchema', () => {
  function validFinding(over: Partial<DevReviewFinding> = {}): DevReviewFinding {
    return {
      severity: 'P1',
      category: 'correctness',
      file: 'core/agent-runtime/codex-cli.ts',
      line: 42,
      summary: 'off-by-one in loop',
      suggestion: 'use < instead of <=',
      ...over,
    };
  }

  it('accepts a no-blockers verdict with empty findings', () => {
    expect(() =>
      DevReviewOutputSchema.parse({
        verdict: 'no-blockers',
        findings: [],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'no blockers' }],
      }),
    ).not.toThrow();
  });

  it('accepts a blockers-found verdict with valid findings', () => {
    expect(() =>
      DevReviewOutputSchema.parse({
        verdict: 'blockers-found',
        findings: [validFinding()],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'P1 found' }],
      }),
    ).not.toThrow();
  });

  it('REJECTS a finding without file (evidence requirement)', () => {
    const finding = { ...validFinding() } as Partial<DevReviewFinding>;
    finding.file = undefined;
    expect(() => DevReviewFindingSchema.parse(finding)).toThrow();
  });

  it('REJECTS a finding without line (evidence requirement)', () => {
    const finding = { ...validFinding() } as Partial<DevReviewFinding>;
    finding.line = undefined;
    expect(() => DevReviewFindingSchema.parse(finding)).toThrow();
  });

  it('REJECTS empty file path', () => {
    expect(() => DevReviewFindingSchema.parse(validFinding({ file: '' }))).toThrow();
  });

  it('REJECTS negative line number', () => {
    expect(() => DevReviewFindingSchema.parse(validFinding({ line: -1 }))).toThrow();
  });

  it('REJECTS unknown severity', () => {
    const bad = { ...validFinding() } as unknown as Record<string, unknown>;
    bad.severity = 'P5';
    expect(() => DevReviewFindingSchema.parse(bad)).toThrow();
  });

  it('REJECTS unknown category', () => {
    const bad = { ...validFinding() } as unknown as Record<string, unknown>;
    bad.category = 'style';
    expect(() => DevReviewFindingSchema.parse(bad)).toThrow();
  });

  it('REQUIRES decisionSummaries field', () => {
    expect(() =>
      DevReviewOutputSchema.parse({
        verdict: 'no-blockers',
        findings: [],
      }),
    ).toThrow();
  });

  it('accepts inconclusive verdict', () => {
    expect(() =>
      DevReviewOutputSchema.parse({
        verdict: 'inconclusive',
        findings: [],
        decisionSummaries: [
          { kind: 'BLOCKER', summary: 'diff too large for fresh-context window' },
        ],
      }),
    ).not.toThrow();
  });
});

// ─── holdout context-exclusion guard (dev-review keys never reach QA / Reviewer) ─

describe('holdout context-exclusion guard for dev-review keys', () => {
  function makeSpec(role: string, overrides: Partial<AgentSpec> = {}): AgentSpec {
    return {
      runId: 'guard-test-run',
      role: role as AgentSpec['role'],
      skill: role === 'qa' ? 'qa' : 'review',
      context: { projectId: 'p', workItemId: 'i' },
      contextAllowlist: ['workItem', 'prDiff'],
      freshContext: true,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
      personaId: `p/${role}/0`,
      ...overrides,
    };
  }

  it('declares the dev-review forbidden-keys set', () => {
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewFindings')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewVerdict')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewSummaries')).toBe(true);
  });

  it('findHoldoutContextLeaks returns [] for safe holdout specs', () => {
    expect(findHoldoutContextLeaks(makeSpec('qa'))).toEqual([]);
    expect(findHoldoutContextLeaks(makeSpec('reviewer'))).toEqual([]);
  });

  it('findHoldoutContextLeaks returns [] for non-holdout roles even when leaks present', () => {
    const spec = makeSpec('developer', { context: { devReviewFindings: ['leak'] } });
    expect(findHoldoutContextLeaks(spec)).toEqual([]);
  });

  it('findHoldoutContextLeaks flags devReviewFindings in QA context', () => {
    const spec = makeSpec('qa', { context: { devReviewFindings: ['x'] } });
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks).toEqual([{ key: 'devReviewFindings', source: 'context' }]);
  });

  it('findHoldoutContextLeaks flags devReviewFindings in Reviewer allowlist', () => {
    const spec = makeSpec('reviewer', { contextAllowlist: ['workItem', 'devReviewFindings'] });
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks).toEqual([{ key: 'devReviewFindings', source: 'allowlist' }]);
  });

  it('flags multiple leaks across both context and allowlist', () => {
    const spec = makeSpec('qa', {
      context: { devReviewVerdict: 'no-blockers' },
      contextAllowlist: ['workItem', 'devReviewFindings'],
    });
    const leaks = findHoldoutContextLeaks(spec);
    const keys = leaks.map((l) => l.key);
    expect(keys).toContain('devReviewVerdict');
    expect(keys).toContain('devReviewFindings');
  });

  it('assembleSpawnContext STRIPS forbidden keys from rendered XML even when in allowlist', () => {
    const spec = makeSpec('qa', {
      context: {
        projectId: 'p',
        workItemId: 'i',
        devReviewFindings: 'leaked-secret-content',
      },
      contextAllowlist: ['devReviewFindings'],
    });
    const { contextXml } = assembleSpawnContext(spec);
    expect(contextXml).not.toContain('devReviewFindings');
    expect(contextXml).not.toContain('leaked-secret-content');
  });

  it('assembleSpawnContext emits tool.violation for each forbidden-key leak', () => {
    const spec = makeSpec('qa', {
      context: { devReviewFindings: 'x', devReviewVerdict: 'y' },
    });
    assembleSpawnContext(spec);
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    const leakViolations = violations.filter(
      ([e]) => (e.payload as { leak?: string }).leak === 'dev-review',
    );
    expect(leakViolations).toHaveLength(2);
    const keys = leakViolations.map(([e]) => (e.payload as { leakedKey: string }).leakedKey);
    expect(keys).toContain('devReviewFindings');
    expect(keys).toContain('devReviewVerdict');
  });

  it('flags DOTTED forbidden-key allowlist entries (renderManifest supports dotted paths)', () => {
    // renderManifest projects nested values via dotted allowlist entries like
    // `devReviewFindings.summary` — so the leak guard must normalise to the
    // top-level key before comparing against HOLDOUT_FORBIDDEN_KEYS.
    const spec = makeSpec('qa', {
      contextAllowlist: ['workItem', 'devReviewFindings.summary'],
    });
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toEqual({ key: 'devReviewFindings.summary', source: 'allowlist' });
  });

  it('STRIPS dotted forbidden-key allowlist entries from rendered XML', () => {
    const spec = makeSpec('qa', {
      context: {
        projectId: 'p',
        workItemId: 'i',
        devReviewFindings: { summary: 'leaked-secret-content', severity: 'P1' },
      },
      contextAllowlist: ['devReviewFindings.summary'],
    });
    const { contextXml } = assembleSpawnContext(spec);
    expect(contextXml).not.toContain('devReviewFindings');
    expect(contextXml).not.toContain('leaked-secret-content');
  });

  it('non-holdout roles can carry dev-review keys without violation', () => {
    const spec = makeSpec('developer', {
      context: {
        projectId: 'p',
        workItemId: 'i',
        devReviewFindings: 'fine-here',
      },
      contextAllowlist: ['devReviewFindings'],
    });
    assembleSpawnContext(spec);
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    const leakViolations = violations.filter(
      ([e]) => (e.payload as { leak?: string }).leak === 'dev-review',
    );
    expect(leakViolations).toHaveLength(0);
  });
});
