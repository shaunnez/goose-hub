import { describe, expect, it } from 'vitest';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { type ScoutSpec, dispatchWave, resolveScoutConcurrencyCap } from './swarm.js';

function makeFakeAppendEvent(): {
  fn: (input: AppendEventInput) => AgentEvent;
  events: AppendEventInput[];
} {
  const events: AppendEventInput[] = [];
  let id = 0;
  const fn = (input: AppendEventInput): AgentEvent => {
    events.push(input);
    return {
      id: ++id,
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      kind: input.kind,
      payload: input.payload,
      runId: input.runId ?? null,
      personaId: input.personaId ?? null,
      createdAt: new Date(0).toISOString(),
    };
  };
  return { fn, events };
}

function makeWorkItem() {
  return { number: 558, title: 'Wave 1/2 swarm', body: 'Add scouts.' };
}

function makeScoutSpec(scoutName: string): ScoutSpec {
  return {
    scoutName,
    scoutFocus: `Inspect ${scoutName} concern.`,
    contextSchema: { findings: [] },
  };
}

function okResult(scoutName: string): AgentResult {
  return {
    output: {
      findings: [{ file: `src/${scoutName}.ts`, line: 1, fact: 'exists', confidence: 'high' }],
      decisionSummaries: [{ kind: 'READ', summary: `${scoutName} scanned` }],
      status: 'ok',
    },
    decisionSummaries: [{ kind: 'READ', summary: `${scoutName} scanned` }],
    events: [],
  };
}

function makeRuntime(impls: Record<string, () => Promise<AgentResult>>): AgentRuntime {
  return {
    async run(spec: AgentSpec): Promise<AgentResult> {
      const impl = impls[spec.skill];
      if (impl == null) throw new Error(`No fake runtime for skill ${spec.skill}`);
      return impl();
    },
  };
}

function testBudgetResolver(skill: string) {
  return {
    budgets: {
      maxTurns: skill === 'scout-code-path' ? 21 : 20,
      maxBudgetUsd: 0.5,
      timeoutMs: 120_000,
    },
    modelOverride: `model-for-${skill}`,
  };
}

describe('swarm.dispatchWave', () => {
  describe('resolveScoutConcurrencyCap', () => {
    it('defaults to the smaller of six and the scout count', () => {
      expect(resolveScoutConcurrencyCap(8, undefined)).toBe(6);
      expect(resolveScoutConcurrencyCap(3, undefined)).toBe(3);
    });

    it('keeps enabled swarms at one scout minimum for zero or invalid caps', () => {
      expect(resolveScoutConcurrencyCap(6, 0)).toBe(1);
      expect(resolveScoutConcurrencyCap(6, -2)).toBe(1);
      expect(resolveScoutConcurrencyCap(6, Number.NaN)).toBe(6);
    });

    it('never exceeds the actual scout count', () => {
      expect(resolveScoutConcurrencyCap(2, 10)).toBe(2);
    });
  });

  it('dispatches all scouts in parallel and returns ok status when all succeed', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-test-inventory': () => Promise.resolve(okResult('scout-test-inventory')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-1',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-test-inventory'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000, // long enough never to fire in test
      scoutTimeoutMs: 5_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(result.status).toBe('ok');
    expect(result.shouldAdvance).toBe(true);
    expect(result.shouldEscalate).toBe(false);
    expect(result.reports).toHaveLength(3);
    expect(result.reports.every((r) => r.status === 'ok')).toBe(true);
    // emits a wave-completed event
    expect(events.some((e) => e.kind === 'swarm.wave-completed')).toBe(true);
    // each scout emits a per-scout completed event
    expect(events.filter((e) => e.kind === 'swarm.scout-completed')).toHaveLength(3);
  });

  it('uses custom minSuccessfulScouts so two successful scouts complete a wave', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'wave2-interface-designer': () => Promise.resolve(okResult('wave2-interface-designer')),
      'wave2-risk-analyst': () => Promise.resolve(okResult('wave2-risk-analyst')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-wave2',
      scoutSpecs: [makeScoutSpec('wave2-interface-designer'), makeScoutSpec('wave2-risk-analyst')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000,
      scoutTimeoutMs: 5_000,
      minSuccessfulScouts: 2,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(result.status).toBe('ok');
    expect(result.shouldAdvance).toBe(true);
    expect(events.some((e) => e.kind === 'swarm.wave-completed')).toBe(true);
  });

  it('keeps default Wave-1 policy so two successes without override are incomplete', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-a': () => Promise.resolve(okResult('scout-a')),
      'scout-b': () => Promise.resolve(okResult('scout-b')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-default-min',
      scoutSpecs: [makeScoutSpec('scout-a'), makeScoutSpec('scout-b')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000,
      scoutTimeoutMs: 5_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(result.status).toBe('incomplete');
    expect(result.shouldAdvance).toBe(false);
    expect(result.shouldEscalate).toBe(false);
    expect(events.some((e) => e.kind === 'swarm.wave-incomplete')).toBe(true);
  });

  it('caps concurrency at maxScoutAgents (default 6) — never exceeded even with 8 specs', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    let live = 0;
    let peak = 0;

    const slowScout = (): Promise<AgentResult> =>
      new Promise((resolve) => {
        live++;
        peak = Math.max(peak, live);
        setTimeout(() => {
          live--;
          resolve(okResult('s'));
        }, 30);
      });

    const specs: ScoutSpec[] = [];
    const impls: Record<string, () => Promise<AgentResult>> = {};
    for (let i = 0; i < 8; i++) {
      const name = `scout-${i}`;
      specs.push(makeScoutSpec(name));
      impls[name] = slowScout;
    }

    await dispatchWave({
      parentRunId: 'parent-2',
      scoutSpecs: specs,
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime: makeRuntime(impls),
      appendEvent,
      heartbeatIntervalMs: 60_000,
      scoutTimeoutMs: 5_000,
      maxScoutAgents: 4,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('records timeout status when a scout exceeds scoutTimeoutMs and advances if ≥3 ok', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-pattern': () => Promise.resolve(okResult('scout-pattern')),
      // sleeps past timeout
      'scout-slow': () =>
        new Promise<AgentResult>((resolve) => {
          setTimeout(() => resolve(okResult('scout-slow')), 200);
        }),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-3',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
        makeScoutSpec('scout-slow'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 30,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    const slow = result.reports.find((r) => r.scoutName === 'scout-slow');
    expect(slow?.status).toBe('timeout');
    // 3 succeeded, 1 timeout: shouldAdvance per "≤1 failure tolerated"
    expect(result.shouldAdvance).toBe(true);
    expect(result.shouldEscalate).toBe(false);
    expect(result.status).toBe('ok');
    expect(events.some((e) => e.kind === 'swarm.scout-timeout')).toBe(true);
    expect(events.some((e) => e.kind === 'agent.cancelled')).toBe(true);
  });

  it('halts and signals escalation when ≥2 scouts fail', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-fail-1': () => Promise.reject(new Error('runtime error 1')),
      'scout-fail-2': () => Promise.reject(new Error('runtime error 2')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-4',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-fail-1'),
        makeScoutSpec('scout-fail-2'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 5_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(result.status).toBe('halted');
    expect(result.shouldEscalate).toBe(true);
    expect(result.shouldAdvance).toBe(false);
    expect(result.failedScouts.sort()).toEqual(['scout-fail-1', 'scout-fail-2']);
    expect(events.some((e) => e.kind === 'swarm.wave-halted')).toBe(true);
  });

  it('records incomplete status if fewer than 3 scouts succeed', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-fail-1': () => Promise.reject(new Error('boom')),
      'scout-fail-2': () => Promise.reject(new Error('boom')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-5',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-fail-1'),
        makeScoutSpec('scout-fail-2'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 5_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    // 2 failures → halted (still escalation).
    expect(result.shouldEscalate).toBe(true);
    expect(events.some((e) => e.kind === 'swarm.wave-halted')).toBe(true);
  });

  it('emits swarm.heartbeat at the configured interval while scouts are running', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-a': () =>
        new Promise<AgentResult>((resolve) => setTimeout(() => resolve(okResult('scout-a')), 80)),
      'scout-b': () =>
        new Promise<AgentResult>((resolve) => setTimeout(() => resolve(okResult('scout-b')), 80)),
      'scout-c': () =>
        new Promise<AgentResult>((resolve) => setTimeout(() => resolve(okResult('scout-c')), 80)),
    });

    await dispatchWave({
      parentRunId: 'parent-hb',
      scoutSpecs: [makeScoutSpec('scout-a'), makeScoutSpec('scout-b'), makeScoutSpec('scout-c')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 20,
      resolveScoutBudget: testBudgetResolver,
    });

    const heartbeats = events.filter((e) => e.kind === 'swarm.heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('emits tool.violation when parent decision-summary key leaks into a scout context (holdout discipline)', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-pattern': () => Promise.resolve(okResult('scout-pattern')),
    });

    await dispatchWave({
      parentRunId: 'parent-leak',
      scoutSpecs: [
        // a sibling decision-summary key leaks in via per-scout context
        {
          scoutName: 'scout-schema',
          scoutFocus: 'schema',
          extraContext: { parentDecisionSummaries: [{ kind: 'PLAN', summary: 'shadow' }] },
        },
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    const violations = events.filter((e) => e.kind === 'tool.violation');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const v = violations[0]?.payload as { disallowedKey: string; role: string };
    expect(v.disallowedKey).toBe('parentDecisionSummaries');
    expect(v.role).toBe('scout');
  });

  it('marks status: "error" when a scout returns output that fails ScoutOutputSchema validation', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const garbageRuntime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-pattern': () => Promise.resolve(okResult('scout-pattern')),
      // Scout that returns arbitrary text (no findings, no schema fields).
      'scout-broken': () =>
        Promise.resolve({
          output: 'I am a free-text response, ignoring the schema',
          decisionSummaries: [],
          events: [],
        }),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-bad',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
        makeScoutSpec('scout-broken'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime: garbageRuntime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    const broken = result.reports.find((r) => r.scoutName === 'scout-broken');
    expect(broken?.status).toBe('error');
    expect(broken?.errorReason).toContain('schema validation');
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
    // 3 succeeded + 1 invalid: still advances (≤1 failure tolerated).
    expect(result.shouldAdvance).toBe(true);
  });

  it('succeeds when a scout returns a decisionSummaries kind not in the enum (coerced to UNKNOWN)', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-pattern': () =>
        Promise.resolve({
          output: {
            findings: [{ file: 'src/foo.ts', line: 1, fact: 'exists', confidence: 'high' }],
            decisionSummaries: [
              { kind: 'READ', summary: 'scanned' },
              { kind: 'HALLUCINATED_KIND', summary: 'model invented this kind' },
            ],
            status: 'ok',
          },
          decisionSummaries: [],
          events: [],
        }),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-coerce',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    const patternReport = result.reports.find((r) => r.scoutName === 'scout-pattern');
    expect(patternReport?.status).toBe('ok');
    expect(patternReport?.decisionSummaries.some((d) => d.kind === 'UNKNOWN')).toBe(true);
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(false);
    expect(result.shouldAdvance).toBe(true);
  });

  it('forwards loadSkillAssets results to the AgentSpec on each scout spawn', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };

    await dispatchWave({
      parentRunId: 'parent-assets',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      loadSkillAssets: (scoutName) => ({
        appendSystemPrompt: `prompt for ${scoutName}`,
        outputJsonSchema: { type: 'object', $id: scoutName },
      }),
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(3);
    for (const spec of seenSpecs) {
      expect(spec.appendSystemPrompt).toBe(`prompt for ${spec.skill}`);
      expect(spec.outputJsonSchema).toEqual({ type: 'object', $id: spec.skill });
    }
  });

  it('uses resolved per-skill budgets and model overrides for child scout spawns', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };

    await dispatchWave({
      parentRunId: 'parent-budget',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      projectBudgets: { skillBudgetOverrides: { 'scout-schema': { maxTurns: 25 } } },
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: (skill, projectBudgets, projectId) => {
        expect(projectId).toBe('goose-hub-self');
        expect(projectBudgets?.skillBudgetOverrides?.['scout-schema']?.maxTurns).toBe(25);
        return {
          budgets: {
            maxTurns: skill === 'scout-schema' ? 25 : 20,
            maxBudgetUsd: 0.5,
            timeoutMs: 120_000,
          },
          modelOverride: `resolved-${skill}`,
        };
      },
    });

    expect(seenSpecs).toHaveLength(3);
    const schemaSpec = seenSpecs.find((s) => s.skill === 'scout-schema');
    const codePathSpec = seenSpecs.find((s) => s.skill === 'scout-code-path');
    expect(schemaSpec?.budgets).toEqual({
      maxTurns: 25,
      maxBudgetUsd: 0.5,
      timeoutMs: 120_000,
    });
    expect(schemaSpec?.modelOverride).toBe('resolved-scout-schema');
    expect(codePathSpec?.budgets.maxTurns).toBe(20);
    expect(codePathSpec?.modelOverride).toBe('resolved-scout-code-path');
  });

  it('routes each child spawn through assembleSpawnContext (freshContext: true per scout)', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };

    await dispatchWave({
      parentRunId: 'parent-fresh',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(3);
    for (const spec of seenSpecs) {
      expect(spec.freshContext).toBe(true);
      expect(spec.runId.startsWith('parent-fresh:scout:')).toBe(true);
      // Allowlist must not include any parent-summary key
      expect(spec.contextAllowlist).not.toContain('parentDecisionSummaries');
      expect(spec.contextAllowlist).toContain('workItem.title');
      expect(spec.contextAllowlist).toContain('scoutFocus');
    }
  });
});
