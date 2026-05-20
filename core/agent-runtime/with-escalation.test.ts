import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ImplementSchema } from '../../skills/implement/schema.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { HoldoutFallbackForbiddenError } from './interface.js';
import { runWithEscalation } from './with-escalation.js';

const appendEvent = vi
  .fn()
  .mockReturnValue({ id: 1, kind: 'agent.retry-escalated', createdAt: '' });

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => appendEvent(...(args as [unknown])),
  },
}));

const Schema = z.object({ ok: z.literal(true) });

const validImplementOutput = {
  plan: '1. Add a regression test. 2. Fix the retry prompt. 3. Run focused tests.',
  filesWritten: [{ path: 'core/agent-runtime/with-escalation.ts', reason: 'repair retry prompt' }],
  testsWritten: [{ path: 'core/agent-runtime/with-escalation.test.ts', cases: 1 }],
  testsRun: {
    command: 'pnpm vitest',
    paths: ['core/agent-runtime/with-escalation.test.ts'],
  },
  prUrl: 'https://github.com/owner/repo/issues/123',
  evidenceSpecPath: null,
  confidence: 'high',
  decisionSummaries: [
    { kind: 'PLAN', summary: 'Add a validation repair retry for terminal JSON shape failures' },
  ],
  selfQualityScore: {
    openClosed: 18,
    conceptCount: 12,
    timeToCapability: 13,
    complecting: 14,
    loc: 8,
    coupling: 9,
    gallsLaw: 9,
    cyclomaticComplexity: 4,
  },
  selfScoreBelowThreshold: false,
  selfScoreWarnings: [],
};

function makeSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    runId: 'run-1',
    role: 'developer',
    skill: 'implement',
    context: {},
    contextAllowlist: [],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 150, maxBudgetUsd: 6, timeoutMs: 900_000 },
    personaId: 'p/dev/0',
    modelOverride: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

function makeResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

function makeRuntime(impl: AgentRuntime['run']): AgentRuntime {
  return { run: impl };
}

describe('runWithEscalation — happy path', () => {
  it('returns parsed output without escalating when haiku run validates', async () => {
    appendEvent.mockClear();
    const runtime = makeRuntime(vi.fn().mockResolvedValue(makeResult({ ok: true })));
    const out = await runWithEscalation({
      runtime,
      spec: makeSpec(),
      schema: Schema,
      projectId: 'p',
      workItemId: 'w',
    });
    expect(out.escalated).toBe(false);
    expect(out.output).toEqual({ ok: true });
    expect(runtime.run).toHaveBeenCalledTimes(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

describe('runWithEscalation — escalation', () => {
  it('retries at sonnet when haiku output fails schema validation', async () => {
    appendEvent.mockClear();
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ wrong: 'shape' }))
      .mockResolvedValueOnce(makeResult({ ok: true }));
    const runtime = makeRuntime(runFn);

    const out = await runWithEscalation({
      runtime,
      spec: makeSpec(),
      schema: Schema,
      projectId: 'p',
      workItemId: 'w',
    });

    expect(out.escalated).toBe(true);
    expect(out.output).toEqual({ ok: true });
    expect(runFn).toHaveBeenCalledTimes(2);

    const firstCallSpec = runFn.mock.calls[0][0] as AgentSpec;
    const retrySpec = runFn.mock.calls[1][0] as AgentSpec;

    expect(firstCallSpec.modelOverride).toContain('haiku');
    expect(retrySpec.modelOverride).toContain('sonnet');
    expect(retrySpec.runId).not.toBe(firstCallSpec.runId);
    expect(retrySpec.budgets.maxBudgetUsd).toBeGreaterThan(firstCallSpec.budgets.maxBudgetUsd);

    expect(appendEvent).toHaveBeenCalledTimes(1);
    const eventCall = appendEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(eventCall.kind).toBe('agent.retry-escalated');
    const payload = eventCall.payload as Record<string, unknown>;
    expect(payload.stage).toBe('model');
    expect(payload.skill).toBe('implement');
    expect(payload.fromModel).toContain('haiku');
    expect(payload.toModel).toContain('sonnet');
    expect(payload.reason).toBe('schema-validation-failed');
  });

  it('preserves Codex provider when escalating haiku to sonnet', async () => {
    appendEvent.mockClear();
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ wrong: 'shape' }))
      .mockResolvedValueOnce(makeResult({ ok: true }));
    const runtime = makeRuntime(runFn);

    const out = await runWithEscalation({
      runtime,
      spec: makeSpec({ modelOverride: 'gpt-5.4-mini' }),
      schema: Schema,
      projectId: 'p',
      workItemId: 'w',
    });

    expect(out.escalated).toBe(true);
    const retrySpec = runFn.mock.calls[1][0] as AgentSpec;
    expect(retrySpec.modelOverride).toBe('gpt-5.4');
    const payload = appendEvent.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.fromModel).toBe('gpt-5.4-mini');
    expect(payload.toModel).toBe('gpt-5.4');
  });

  it('throws when sonnet retry also fails validation', async () => {
    appendEvent.mockClear();
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ wrong: 'shape' }))
      .mockResolvedValueOnce(makeResult({ still: 'wrong' }));
    const runtime = makeRuntime(runFn);

    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec(),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow(/validation failed after sonnet-tier validation retry/i);
    expect(runFn).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenCalledTimes(2);
    const repairFailed = appendEvent.mock.calls[1][0] as Record<string, unknown>;
    expect(repairFailed.kind).toBe('agent.output-repair-failed');
    expect(repairFailed.payload).toMatchObject({
      skill: 'implement',
      reason: 'terminal-output-validation-failed-after-repair-retry',
      message:
        'Implementation/tool execution may have succeeded; the failure is terminal JSON output validation.',
    });
  });

  it('repairs implement terminal JSON when self-quality fields exceed schema limits', async () => {
    appendEvent.mockClear();
    const invalidOutput = {
      ...validImplementOutput,
      selfQualityScore: {
        openClosed: 21,
        conceptCount: 16,
        timeToCapability: 16,
        complecting: 16,
        loc: 11,
        coupling: 11,
        gallsLaw: 11,
        cyclomaticComplexity: 6,
      },
      selfScoreBelowThreshold: false,
    };
    const correctedOutput = validImplementOutput;
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult(invalidOutput))
      .mockResolvedValueOnce(makeResult(correctedOutput));
    const runtime = makeRuntime(runFn);

    const out = await runWithEscalation({
      runtime,
      spec: makeSpec({ appendSystemPrompt: 'Base implement prompt.' }),
      schema: ImplementSchema,
      projectId: 'p',
      workItemId: 'w',
    });

    expect(out.escalated).toBe(true);
    expect(out.output.selfQualityScore).toEqual(validImplementOutput.selfQualityScore);
    expect(runFn).toHaveBeenCalledTimes(2);

    const retrySpec = runFn.mock.calls[1][0] as AgentSpec;
    expect(retrySpec.appendSystemPrompt).toContain('Base implement prompt.');
    expect(retrySpec.appendSystemPrompt).toContain('Terminal JSON Validation Repair');
    expect(retrySpec.appendSystemPrompt).toContain('Do not redo implementation work');
    expect(retrySpec.appendSystemPrompt).toContain('return corrected JSON only');
    expect(retrySpec.appendSystemPrompt).toContain('selfQualityScore.openClosed');
    expect(retrySpec.appendSystemPrompt).toContain('selfQualityScore.cyclomaticComplexity');
    expect(retrySpec.appendSystemPrompt).toContain('"openClosed": 21');
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });

  it('retries at the same tier when escalation target equals current tier (opus→opus)', async () => {
    appendEvent.mockClear();
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ wrong: 'shape' }))
      .mockResolvedValueOnce(makeResult({ ok: true }));
    const runtime = makeRuntime(runFn);

    const out = await runWithEscalation({
      runtime,
      spec: makeSpec({ modelOverride: 'claude-opus-4-7' }),
      schema: Schema,
      projectId: 'p',
      workItemId: 'w',
      // Override implement's escalation to opus → simulates a hypothetical
      // opus-pinned skill. The key behaviour: same-tier retry is allowed.
      projectBudgets: {
        skillBudgetOverrides: {
          implement: { escalation: { modelTier: 'opus', maxBudgetUsd: 30 } },
        },
      },
    });

    expect(out.escalated).toBe(true);
    expect(runFn).toHaveBeenCalledTimes(2);
    const firstSpec = runFn.mock.calls[0][0] as AgentSpec;
    const retrySpec = runFn.mock.calls[1][0] as AgentSpec;
    expect(firstSpec.modelOverride).toContain('opus');
    expect(retrySpec.modelOverride).toContain('opus');
    expect(retrySpec.runId).not.toBe(firstSpec.runId);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const payload = appendEvent.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.fromModel).toContain('opus');
    expect(payload.toModel).toContain('opus');
  });
});

describe('runWithEscalation — no-escalation guards', () => {
  it('retries at the same tier when escalation target equals current tier (sonnet→sonnet)', async () => {
    appendEvent.mockClear();
    const runFn = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ wrong: 'shape' }))
      .mockResolvedValueOnce(makeResult({ ok: true }));
    const runtime = makeRuntime(runFn);

    // Spec already at sonnet (e.g. via withFallback degradation); implement's
    // escalation target is sonnet — same-tier retry is allowed and gets the
    // recalculated escalation budget.
    const out = await runWithEscalation({
      runtime,
      spec: makeSpec({ modelOverride: 'claude-sonnet-4-6' }),
      schema: Schema,
      projectId: 'p',
      workItemId: 'w',
    });

    expect(out.escalated).toBe(true);
    expect(runFn).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const retrySpec = runFn.mock.calls[1][0] as AgentSpec;
    expect(retrySpec.modelOverride).toContain('sonnet');
  });

  it('does not escalate when current tier is above escalation target (opus > sonnet)', async () => {
    appendEvent.mockClear();
    const runFn = vi.fn().mockResolvedValue(makeResult({ wrong: 'shape' }));
    const runtime = makeRuntime(runFn);

    // Spec runs at opus; implement's escalation target is sonnet — never downgrade
    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec({ modelOverride: 'claude-opus-4-7' }),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow(/validation failed/i);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('does not escalate when skill has no escalation policy', async () => {
    appendEvent.mockClear();
    const runFn = vi.fn().mockResolvedValue(makeResult({ wrong: 'shape' }));
    const runtime = makeRuntime(runFn);

    // triage is haiku-tier but explicitly has no escalation policy
    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec({ skill: 'triage' }),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow(/validation failed/i);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('throws HoldoutFallbackForbiddenError when role is qa and validation fails', async () => {
    appendEvent.mockClear();
    const runFn = vi.fn().mockResolvedValue(makeResult({ wrong: 'shape' }));
    const runtime = makeRuntime(runFn);

    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec({ role: 'qa', skill: 'qa', freshContext: true }),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow(HoldoutFallbackForbiddenError);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('throws HoldoutFallbackForbiddenError when role is reviewer and validation fails', async () => {
    appendEvent.mockClear();
    const runFn = vi.fn().mockResolvedValue(makeResult({ wrong: 'shape' }));
    const runtime = makeRuntime(runFn);

    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec({ role: 'reviewer', skill: 'review', freshContext: true }),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow(HoldoutFallbackForbiddenError);
  });
});

describe('runWithEscalation — subprocess errors pass through', () => {
  it('does not escalate on subprocess errors (those go to withFallback)', async () => {
    appendEvent.mockClear();
    const runFn = vi.fn().mockRejectedValue(new Error('subprocess died'));
    const runtime = makeRuntime(runFn);

    await expect(
      runWithEscalation({
        runtime,
        spec: makeSpec(),
        schema: Schema,
        projectId: 'p',
        workItemId: 'w',
      }),
    ).rejects.toThrow('subprocess died');
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
