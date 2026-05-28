import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { type ScoutSpec, dispatchWave, resolveScoutConcurrencyCap } from './swarm.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

function makeInvestigationSeed() {
  return {
    candidateFiles: [{ path: 'src/auth.ts', root: 'worktree' }],
    candidateSymbols: [],
    testFiles: [],
    recentlyChangedFiles: [],
    priorInvestigationRunIds: [],
    builtAt: '2026-05-23T00:00:00.000Z',
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

function emptyResult(events: AgentResult['events'] = []): AgentResult {
  return {
    output: {
      findings: [],
      decisionSummaries: [{ kind: 'READ', summary: 'scout completed without findings' }],
      status: 'ok',
    },
    decisionSummaries: [{ kind: 'READ', summary: 'scout completed without findings' }],
    events,
  };
}

function skippedResult(summary = 'Scout domain does not apply'): AgentResult {
  return {
    output: {
      findings: [],
      decisionSummaries: [{ kind: 'INSIGHT', summary }],
      status: 'skipped',
    },
    decisionSummaries: [{ kind: 'INSIGHT', summary }],
    events: [],
  };
}

async function makeSeedWorktree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'goose-scout-seed-'));
  tempDirs.push(dir);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(
    join(dir, 'src/auth.ts'),
    'export function authState() { return "signed-in"; }\n',
    'utf8',
  );
  return dir;
}

function runtimeAdvisoryEvent(
  runId: string,
  surface: 'resources/list failed' | 'resources/templates/list failed' | 'resources/read failed',
): AgentResult['events'][number] {
  return {
    id: 1,
    projectId: 'goose-hub-self',
    workItemId: 'github:owner/repo#558',
    kind: 'agent.runtime-advisory',
    payload: { runId, surface, toolName: surface.replace(' failed', '') },
    runId,
    personaId: 'goose-hub-self/investigator/0',
    createdAt: new Date(0).toISOString(),
  };
}

function toolCallEvent(
  runId: string,
  toolName: string,
  status?: 'ok' | 'failed' | 'timed_out',
): AgentResult['events'][number] {
  return {
    id: 2,
    projectId: 'goose-hub-self',
    workItemId: 'github:owner/repo#558',
    kind: 'agent.tool-call',
    payload: { run_id: runId, tool_name: toolName, ...(status != null ? { status } : {}) },
    runId,
    personaId: 'goose-hub-self/investigator/0',
    createdAt: new Date(0).toISOString(),
  };
}

function makeRuntime(
  impls: Record<string, (spec: AgentSpec) => Promise<AgentResult>>,
): AgentRuntime {
  return {
    async run(spec: AgentSpec): Promise<AgentResult> {
      const impl = impls[spec.skill];
      if (impl == null) throw new Error(`No fake runtime for skill ${spec.skill}`);
      return impl(spec);
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
      'scout-slow': () => Promise.reject(new Error('Agent run scout-slow timed out after 30ms')),
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

  it('passes worktreePath as workspaceDir to every child scout runtime spec', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };

    await dispatchWave({
      parentRunId: 'parent-worktree',
      scoutSpecs: [
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/real-worktree',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 5_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(3);
    expect(seenSpecs.every((spec) => spec.workspaceDir === '/tmp/real-worktree')).toBe(true);
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

  it('treats an irrelevant schema scout as skipped without counting it as failed', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(skippedResult('No schema boundary applies')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-skipped-schema',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'ok',
      outcome: 'skipped',
      skippedReason: 'No schema boundary applies',
    });
    expect(result.failedScouts).toEqual([]);
    expect(result.skippedScouts).toEqual(['scout-schema']);
    expect(events.some((e) => e.kind === 'swarm.scout-skipped')).toBe(true);
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(false);
  });

  it('fails a tool-unavailable skip when the scout made no Factory read/search attempt', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-pattern': () =>
        Promise.resolve(
          skippedResult(
            'Could not inspect the workspace because the required Factory read/search tools (`read_file` and `search_text`) are not available in this run.',
          ),
        ),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-tool-skip-no-attempt',
      scoutSpecs: [makeScoutSpec('scout-pattern')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      outcome: 'failed',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-skipped')).toBe(false);
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
  });

  it('fails a tool-unavailable skip even when the scout returned findings', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-pattern': () =>
        Promise.resolve({
          output: {
            findings: [
              {
                file: 'src/fake.ts',
                line: 1,
                fact: 'This finding was returned without using read/search tools.',
                confidence: 'low',
              },
            ],
            decisionSummaries: [
              {
                kind: 'UNCERTAINTY',
                summary:
                  'Could not inspect the workspace because the required Factory read/search tools (`read_file` and `search_text`) are not available in this run.',
              },
            ],
            status: 'skipped',
          },
          decisionSummaries: [
            {
              kind: 'UNCERTAINTY',
              summary:
                'Could not inspect the workspace because the required Factory read/search tools (`read_file` and `search_text`) are not available in this run.',
            },
          ],
          events: [],
        }),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-tool-skip-with-findings',
      scoutSpecs: [makeScoutSpec('scout-pattern')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      outcome: 'failed',
      findings: [],
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-skipped')).toBe(false);
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
  });

  it('retries a tool-unavailable skip with deterministic seed evidence', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-pattern': (spec) => {
        seenSpecs.push(spec);
        if (seenSpecs.length === 1) {
          return Promise.resolve(
            skippedResult(
              'Could not inspect the workspace because the required Factory read/search tools (`read_file` and `search_text`) are not available in this run.',
            ),
          );
        }
        return Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'read_file', 'ok')]));
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-tool-skip-seeded-retry',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-pattern'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(2);
    expect(seenSpecs[1].runId).toBe(
      'parent-tool-skip-seeded-retry:scout:scout-pattern:0:evidence-retry',
    );
    expect(result.reports[0]).toMatchObject({
      status: 'ok',
      outcome: 'ok',
      runId: 'parent-tool-skip-seeded-retry:scout:scout-pattern:0:evidence-retry',
    });
  });

  it('does not halt when two scouts skip and enough useful evidence remains', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-schema': () => Promise.resolve(skippedResult('No schema boundary applies')),
      'scout-test-inventory': () => Promise.resolve(skippedResult('No test surface applies')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-two-skips',
      scoutSpecs: [
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-test-inventory'),
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
      minSuccessfulScouts: 1,
    });

    expect(result.status).toBe('ok');
    expect(result.summary).toBe('completed-with-skips');
    expect(result.okCount).toBe(1);
    expect(result.skippedScouts.sort()).toEqual(['scout-schema', 'scout-test-inventory']);
    expect(result.failedScouts).toEqual([]);
    expect(events.some((e) => e.kind === 'swarm.wave-halted')).toBe(false);
  });

  it('advances when skipped scouts make the original success threshold inapplicable', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
      'scout-test-inventory': () => Promise.resolve(okResult('scout-test-inventory')),
      'scout-schema': () => Promise.resolve(skippedResult('No schema boundary applies')),
      'scout-dependency': () => Promise.resolve(skippedResult('No dependency boundary applies')),
      'scout-user-journey': () => Promise.resolve(skippedResult('No user journey applies')),
      'scout-pattern': () => Promise.resolve(skippedResult('No reusable pattern applies')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-skips-reduce-threshold',
      scoutSpecs: [
        makeScoutSpec('scout-code-path'),
        makeScoutSpec('scout-test-inventory'),
        makeScoutSpec('scout-schema'),
        makeScoutSpec('scout-dependency'),
        makeScoutSpec('scout-user-journey'),
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
      minSuccessfulScouts: 3,
    });

    expect(result.status).toBe('ok');
    expect(result.shouldAdvance).toBe(true);
    expect(result.summary).toBe('completed-with-skips');
    expect(result.okCount).toBe(2);
    expect(result.skippedScouts).toHaveLength(4);
    const waveCompleted = events.find((event) => event.kind === 'swarm.wave-completed');
    expect(waveCompleted?.payload).toMatchObject({
      okCount: 2,
      applicableCount: 2,
      requiredOkCount: 2,
      scoutCount: 6,
    });
  });

  it('still halts when two applicable scouts fail with no evidence', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(emptyResult()),
      'scout-code-path': () => Promise.resolve(emptyResult()),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-two-no-evidence',
      scoutSpecs: [makeScoutSpec('scout-schema'), makeScoutSpec('scout-code-path')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
      minSuccessfulScouts: 1,
    });

    expect(result.status).toBe('halted');
    expect(result.summary).toBe('halted');
    expect(result.failedScouts.sort()).toEqual(['scout-code-path', 'scout-schema']);
    expect(result.shouldEscalate).toBe(true);
  });

  it('fails an ok empty scout without evidence and emits diagnostic payload fields', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(emptyResult()),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-empty-diagnostics',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: {
            investigationSeed: {
              candidateFiles: [],
              candidateSymbols: [],
              testFiles: [],
              recentlyChangedFiles: [],
              priorInvestigationRunIds: [],
              builtAt: '2026-05-28T00:00:00.000Z',
            },
          },
        },
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      outcome: 'failed',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    const failed = events.find((e) => e.kind === 'swarm.scout-failed');
    expect(failed?.payload).toMatchObject({
      runId: 'parent-empty-diagnostics:scout:scout-schema:0',
      scoutName: 'scout-schema',
      outputStatus: 'ok',
      findingsCount: 0,
      decisionSummariesCount: 1,
      hasFactoryEvidenceAttempt: false,
      hasSuccessfulFactoryEvidenceCall: false,
      seedCandidateFileCount: 0,
      modelId: 'model-for-scout-schema',
      retrySkippedReason: 'no-seed-evidence',
    });
  });

  it('fails an empty scout with only resources/list advisory for no evidence, not resource misuse', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        return Promise.resolve(
          emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
        );
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-list-advisory',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    const failed = events.find((e) => e.kind === 'swarm.scout-failed');
    expect(failed?.payload as { errorReason?: string }).toMatchObject({
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect((failed?.payload as { errorReason?: string }).errorReason).not.toContain(
      'forbidden MCP resource probes',
    );
    expect(seenSpecs).toHaveLength(1);
  });

  it('accepts a seeded empty scout after deterministic seed-evidence retry', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        return Promise.resolve(
          emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
        );
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seeded-retry-empty',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(2);
    expect(seenSpecs[1].runId).toBe(
      'parent-seeded-retry-empty:scout:scout-schema:0:evidence-retry',
    );
    expect(seenSpecs[1].appendSystemPrompt).toContain('use provided <seedEvidence>');
    expect(seenSpecs[1].appendSystemPrompt).not.toContain('read_file or search_text');
    expect(
      (seenSpecs[1].context as { seedEvidence?: Array<{ file: string; text: string }> })
        .seedEvidence?.[0],
    ).toMatchObject({
      file: 'src/auth.ts',
      text: expect.stringContaining('authState'),
    });
    expect(result.reports[0]).toMatchObject({
      status: 'ok',
      outcome: 'ok',
    });
  });

  it('accepts a seeded scout when the evidence retry records a successful read_file call', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        if (seenSpecs.length === 1) {
          return Promise.resolve(
            emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
          );
        }
        return Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'read_file', 'ok')]));
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seeded-retry-evidence',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
      minSuccessfulScouts: 1,
    });

    expect(seenSpecs).toHaveLength(2);
    expect(result.reports[0]?.status).toBe('ok');
    expect(result.reports[0]?.runId).toBe(
      'parent-seeded-retry-evidence:scout:scout-schema:0:evidence-retry',
    );
    const completed = events.find((e) => e.kind === 'swarm.scout-completed');
    expect((completed?.payload as { runId?: string }).runId).toBe(
      'parent-seeded-retry-evidence:scout:scout-schema:0:evidence-retry',
    );
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(false);
    expect(result.shouldAdvance).toBe(true);
  });

  it('caps seeded evidence retry to the remaining scout timeout budget', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        if (seenSpecs.length === 1) {
          now = 1_060;
          return Promise.resolve(
            emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
          );
        }
        return Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'read_file', 'ok')]));
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seeded-retry-timeout',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 100,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
      minSuccessfulScouts: 1,
    });

    expect(result.reports[0]?.status).toBe('ok');
    expect(seenSpecs).toHaveLength(2);
    expect(seenSpecs[1].budgets.timeoutMs).toBe(40);
  });

  it('preserves first-attempt decision summaries when retry output fails schema validation without summaries', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        if (seenSpecs.length === 1) {
          return Promise.resolve({
            ...emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
            decisionSummaries: [{ kind: 'READ', summary: 'first attempt summary' }],
          });
        }
        return Promise.resolve({
          output: { invalid: true },
          decisionSummaries: [],
          events: [],
        } as unknown as AgentResult);
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seeded-retry-invalid',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      decisionSummaries: [{ kind: 'READ', summary: 'first attempt summary' }],
    });
  });

  it('does not load seed evidence from path-policy denied workspace internals', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    await mkdir(join(worktreePath, '.factory'), { recursive: true });
    await writeFile(join(worktreePath, '.factory/mcp-config.json'), '{"secret":true}', 'utf8');
    const seenSpecs: AgentSpec[] = [];
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenSpecs.push(spec);
        return Promise.resolve(
          emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
        );
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seed-denylist',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: {
            investigationSeed: {
              ...makeInvestigationSeed(),
              candidateFiles: [{ path: '.factory/mcp-config.json', root: 'worktree' }],
            },
          },
        },
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
    });

    expect(seenSpecs).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      status: 'error',
      outcome: 'failed',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
  });

  it('does not halt a wave when seeded retry evidence leaves only one no-evidence scout', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const worktreePath = await makeSeedWorktree();
    const seenBySkill: Record<string, AgentSpec[]> = {};
    const runtime = makeRuntime({
      'scout-schema': (spec) => {
        seenBySkill[spec.skill] = [...(seenBySkill[spec.skill] ?? []), spec];
        if ((seenBySkill[spec.skill] ?? []).length === 1) {
          return Promise.resolve(
            emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
          );
        }
        return Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'read_file', 'ok')]));
      },
      'scout-pattern': (spec) => {
        seenBySkill[spec.skill] = [...(seenBySkill[spec.skill] ?? []), spec];
        return Promise.resolve(
          emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/list failed')]),
        );
      },
    });

    const result = await dispatchWave({
      parentRunId: 'parent-seeded-wave',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-schema'),
          extraContext: { investigationSeed: makeInvestigationSeed() },
        },
        makeScoutSpec('scout-pattern'),
      ],
      workItem: makeWorkItem(),
      worktreePath,
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
      minSuccessfulScouts: 1,
    });

    expect(seenBySkill['scout-schema']).toHaveLength(2);
    expect(seenBySkill['scout-pattern']).toHaveLength(1);
    expect(result.status).toBe('ok');
    expect(result.shouldEscalate).toBe(false);
    expect(result.failedScouts).toEqual(['scout-pattern']);
  });

  it('fails an empty scout with only resources/templates/list advisory for no evidence, not resource misuse', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': (spec) =>
        Promise.resolve(
          emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/templates/list failed')]),
        ),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-template-advisory',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]?.status).toBe('error');
    const failed = events.find((e) => e.kind === 'swarm.scout-failed');
    expect((failed?.payload as { errorReason?: string }).errorReason).toBe(
      'scout returned no findings and made no successful Factory read/search/file tool calls',
    );
  });

  it('fails an empty scout with resources/read advisory and no successful evidence calls', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': (spec) =>
        Promise.resolve(emptyResult([runtimeAdvisoryEvent(spec.runId, 'resources/read failed')])),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-read-advisory',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
  });

  it('fails an empty scout when Factory evidence calls only have pre-execution audits', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': (spec) =>
        Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'read_file')])),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-pre-tool-audit',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
  });

  it('fails an empty scout when Factory evidence calls timed out', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': (spec) =>
        Promise.resolve(emptyResult([toolCallEvent(spec.runId, 'search_text', 'timed_out')])),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-timed-out-evidence',
      scoutSpecs: [makeScoutSpec('scout-schema')],
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

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      errorReason:
        'scout returned no findings and made no successful Factory read/search/file tool calls',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
  });

  it('keeps an empty scout ok when resource discovery advisories accompany successful evidence calls', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': (spec) =>
        Promise.resolve(
          emptyResult([
            runtimeAdvisoryEvent(spec.runId, 'resources/list failed'),
            runtimeAdvisoryEvent(spec.runId, 'resources/templates/list failed'),
            toolCallEvent(spec.runId, 'read_file', 'ok'),
            toolCallEvent(spec.runId, 'search_text', 'ok'),
          ]),
        ),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-evidence',
      scoutSpecs: [makeScoutSpec('scout-schema')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      scoutTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: testBudgetResolver,
      minSuccessfulScouts: 1,
    });

    expect(result.reports[0]?.status).toBe('ok');
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

  it('can route child scout spawns through a runtime chosen from each resolved model', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const defaultSpecs: AgentSpec[] = [];
    const perScoutSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        defaultSpecs.push(spec);
        return okResult(spec.skill);
      },
    };
    const perScoutRuntime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        perScoutSpecs.push(spec);
        return okResult(spec.skill);
      },
    };

    await dispatchWave({
      parentRunId: 'parent-runtime',
      scoutSpecs: [makeScoutSpec('scout-schema')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000,
      resolveScoutBudget: () => ({
        budgets: { maxTurns: 20, maxBudgetUsd: 0.5, timeoutMs: 120_000 },
        modelOverride: 'gpt-5.4-mini',
      }),
      resolveScoutRuntime: (resolvedBudget, scoutName) => {
        expect(scoutName).toBe('scout-schema');
        expect(resolvedBudget.modelOverride).toBe('gpt-5.4-mini');
        return perScoutRuntime;
      },
    });

    expect(defaultSpecs).toHaveLength(0);
    expect(perScoutSpecs).toHaveLength(1);
    expect(perScoutSpecs[0].modelOverride).toBe('gpt-5.4-mini');
  });

  it('converts resolveScoutRuntime exceptions into scout error reports', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const runtime = makeRuntime({
      'scout-schema': () => Promise.resolve(okResult('scout-schema')),
    });

    const result = await dispatchWave({
      parentRunId: 'parent-runtime-resolver-error',
      scoutSpecs: [makeScoutSpec('scout-schema')],
      workItem: makeWorkItem(),
      worktreePath: '/tmp/wt',
      projectId: 'goose-hub-self',
      personaId: 'goose-hub-self/investigator/0',
      runtime,
      appendEvent,
      heartbeatIntervalMs: 60_000,
      scoutTimeoutMs: 1_000,
      resolveScoutBudget: testBudgetResolver,
      resolveScoutRuntime: () => {
        throw new Error('runtime selection failed');
      },
    });

    expect(result.reports[0]).toMatchObject({
      status: 'error',
      errorReason: 'runtime selection failed',
    });
    expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(true);
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
      expect(spec.contextAllowlist).not.toContain('worktreePath');
      expect((spec.context as { worktreePath?: string }).worktreePath).toBeUndefined();
      expect(spec.contextAllowlist).toContain('workItem.title');
      expect(spec.contextAllowlist).toContain('scoutFocus');
    }
  });

  it('allows investigationSeed in child scout context', async () => {
    const { fn: appendEvent } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };
    const investigationSeed = {
      candidateFiles: [{ path: 'src/auth.ts', root: 'worktree' }],
      candidateSymbols: [],
      testFiles: [],
      recentlyChangedFiles: [],
      priorInvestigationRunIds: [],
      builtAt: '2026-05-23T00:00:00.000Z',
    };

    await dispatchWave({
      parentRunId: 'parent-seed',
      scoutSpecs: [
        {
          ...makeScoutSpec('scout-code-path'),
          extraContext: { investigationSeed },
        },
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

    expect(seenSpecs[0].contextAllowlist).toContain('investigationSeed');
    expect((seenSpecs[0].context as { investigationSeed?: unknown }).investigationSeed).toEqual(
      investigationSeed,
    );
  });

  it('does not emit tool.violation when wave2 spec carries scoutDigest', async () => {
    const { fn: appendEvent, events } = makeFakeAppendEvent();
    const seenSpecs: AgentSpec[] = [];
    const runtime: AgentRuntime = {
      async run(spec: AgentSpec): Promise<AgentResult> {
        seenSpecs.push(spec);
        return okResult(spec.skill);
      },
    };
    const scoutDigest = { summary: 'wave1 found 3 files', runIds: ['run-1', 'run-2'] };

    await dispatchWave({
      parentRunId: 'parent-digest',
      scoutSpecs: [
        {
          scoutName: 'scout-code-path',
          scoutFocus: 'Inspect code path.',
          // No contextSchema so only scoutDigest (allowlisted) lands in fullContext
          extraContext: { scoutDigest },
        },
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
    expect(violations).toHaveLength(0);
    expect(seenSpecs[0].contextAllowlist).toContain('scoutDigest');
    expect((seenSpecs[0].context as { scoutDigest?: unknown }).scoutDigest).toEqual(scoutDigest);
  });
});
