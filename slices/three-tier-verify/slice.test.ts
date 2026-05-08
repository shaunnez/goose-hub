import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  runTier,
  verifyFunctional,
  verifyRegression,
  verifyStructural,
} from '@goose-hub/core/verify/tiers.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { runThreeTierVerifyWorkflow } from './workflow.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-562',
    externalId: '562',
    repoRef: 'shaunnez/goose-hub',
    title: 'M19.05 3-tier verification',
    body: '',
    priority: 'medium',
    type: 'feature',
    mode: 'supervised',
    state: 'factory:needs-qa',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-05-07'),
    ...overrides,
  };
}

function makeWp(id: string, filesOwned: string[]): WorkPackage {
  return { id, filesOwned, changes: `Implement ${id}`, dependsOn: [], builderTier: 'sonnet' };
}

function makeSpec(overrides: Partial<EngineeringSpec> = {}): EngineeringSpec {
  return {
    objective: 'Test 3-tier verify',
    userJourneys: [],
    functionalRequirements: [],
    architecture: { current: 'none', new: 'verified', decisionRationale: 'test' },
    schemaChanges: { ddl: [], migrations: [] },
    interfaceContracts: [],
    workPackages: [makeWp('WP1', ['src/index.ts'])],
    executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
    verificationTooling: [],
    acceptanceCriteria: [
      { id: 'AC1', statement: 'Works', verifyCommand: 'pnpm test', crossCutting: true },
    ],
    constraints: [],
    riskRegister: [],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Test spec' }],
    ...overrides,
  };
}

function makeStateSource(
  overrides: Partial<{
    transitionState: (...args: unknown[]) => Promise<void>;
    comment: (...args: unknown[]) => Promise<void>;
  }> = {},
) {
  return {
    repoRef: 'shaunnez/goose-hub',
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as StateSource;
}

function makeAppendEvent(): {
  fn: (input: AppendEventInput) => AgentEvent;
  events: AppendEventInput[];
} {
  const captured: AppendEventInput[] = [];
  return {
    fn: (input) => {
      captured.push(input);
      return { ...input, id: captured.length, createdAt: new Date().toISOString() } as AgentEvent;
    },
    events: captured,
  };
}

// ─── Tier 1: Structural golden test ──────────────────────────────────────────
// "A no-op PR that changes a comment in filesOwned fails Tier 1
//  (call site / export never reached)"

describe('Tier 1 (Structural) — golden test', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), 'goose-hub-t1-'));
    mkdirSync(join(worktree, 'src'), { recursive: true });
    // File exists, but the declared contract function is NOT exported
    // (simulates a no-op change — only a comment was touched, not the function)
    writeFileSync(
      join(worktree, 'src/index.ts'),
      '// updated comment — no functional change\nexport const version = "1.0.0";\n',
    );
  });

  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  it('fails when interface contract export is absent from filesOwned file', () => {
    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts'])],
      interfaceContracts: [
        {
          name: 'runVerification',
          signature: 'export function runVerification(): void',
          file: 'src/index.ts',
        },
      ],
    });

    const result = verifyStructural(spec, '', worktree);

    expect(result.tier).toBe(1);
    expect(result.passed).toBe(false);
    const errorFindings = result.findings.filter((f) => f.severity === 'error');
    expect(errorFindings.length).toBeGreaterThanOrEqual(1);
    expect(errorFindings.some((f) => f.message.includes('runVerification'))).toBe(true);
  });

  it('passes when the contract export is present', () => {
    writeFileSync(join(worktree, 'src/index.ts'), 'export function runVerification(): void {}\n');
    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts'])],
      interfaceContracts: [
        {
          name: 'runVerification',
          signature: 'export function runVerification(): void',
          file: 'src/index.ts',
        },
      ],
    });

    const result = verifyStructural(spec, '', worktree);

    expect(result.passed).toBe(true);
    expect(result.evidence.some((e) => e.includes('runVerification'))).toBe(true);
  });

  it('fails when a filesOwned path does not exist', () => {
    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts', 'src/missing.ts'])],
    });

    const result = verifyStructural(spec, '', worktree);

    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.message.includes('missing.ts'))).toBe(true);
  });
});

// ─── Tier 2: Functional golden test ──────────────────────────────────────────
// "A PR with broken import fails Tier 2"

describe('Tier 2 (Functional) — golden test', () => {
  it('fails when a verification tool script exits with unexpected code', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'import-smoke',
          scriptPath: 'node -e "require(\'./broken\')"',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationScriptImpl: async (_script, _cwd, expectedExitCodes) => ({
        passed: !expectedExitCodes.includes(0),
        output: "Error: Cannot find module './broken'",
      }),
    });

    expect(result.tier).toBe(2);
    expect(result.passed).toBe(false);
    const errors = result.findings.filter((f) => f.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain('import-smoke');
  });

  it('passes when all verification tools succeed', async () => {
    const spec = makeSpec({
      verificationTooling: [
        { name: 'lint', scriptPath: 'pnpm lint', expectedExitCodes: [0] },
        { name: 'typecheck', scriptPath: 'pnpm typecheck', expectedExitCodes: [0] },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationScriptImpl: async () => ({ passed: true, output: '' }),
    });

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(2);
  });

  it('passes vacuously when no verificationTooling is declared', async () => {
    const spec = makeSpec({ verificationTooling: [] });
    const result = await verifyFunctional(spec, '/tmp');

    expect(result.passed).toBe(true);
    expect(result.evidence).toContain('no-verification-tooling-declared');
  });
});

// ─── Tier 3: Regression golden test ──────────────────────────────────────────
// "A PR breaking a previously-passing test fails Tier 3 with
//  project.regressionPolicy: 'escalate' triggering factory:needs-human"

describe('Tier 3 (Regression) — golden test', () => {
  const baseRunArtifacts = {
    runId: 'run-test-01',
    projectId: 'goose-hub-self',
    workItemId: 'wi-562',
    worktreePath: '/tmp',
    regressionPolicy: 'escalate' as const,
  };

  it('fails and marks error severity when test suite breaks and policy is escalate', async () => {
    const spec = makeSpec();
    const result = await verifyRegression(spec, baseRunArtifacts, {
      getLastWpStatusImpl: () => null,
      runRegressionTestsImpl: async () => ({
        passed: false,
        failedTests: ['FAIL src/index.test.ts > should export runVerification'],
      }),
    });

    expect(result.tier).toBe(3);
    expect(result.passed).toBe(false);
    const errors = result.findings.filter((f) => f.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain('escalate');
  });

  it('passes (warning only) when policy is ignore', async () => {
    const spec = makeSpec();
    const result = await verifyRegression(
      spec,
      { ...baseRunArtifacts, regressionPolicy: 'ignore' },
      {
        getLastWpStatusImpl: () => null,
        runRegressionTestsImpl: async () => ({
          passed: false,
          failedTests: ['FAIL some.test.ts > something'],
        }),
      },
    );

    expect(result.passed).toBe(true);
    const warnings = result.findings.filter((f) => f.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('includes carry-forward evidence for previously-ok WPs', async () => {
    const spec = makeSpec({ workPackages: [makeWp('WP1', ['src/a.ts'])] });
    const result = await verifyRegression(spec, baseRunArtifacts, {
      getLastWpStatusImpl: (_runId, wpId) => (wpId === 'WP1' ? 'ok' : null),
      runRegressionTestsImpl: async () => ({ passed: true, failedTests: [] }),
    });

    expect(result.passed).toBe(true);
    expect(result.evidence.some((e) => e.includes('WP1'))).toBe(true);
  });
});

// ─── End-to-end workflow: Tier 3 failure → factory:needs-human ────────────────

describe('runThreeTierVerifyWorkflow — Tier 3 failure escalates to needs-human', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), 'goose-hub-e2e-'));
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src/index.ts'), 'export const x = 1;\n');
  });

  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  it('transitions to factory:needs-human when Tier 3 regression detected', async () => {
    const stateSource = makeStateSource();
    const { fn: appendEvent, events } = makeAppendEvent();

    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts'])],
      verificationTooling: [],
    });

    const result = await runThreeTierVerifyWorkflow(
      makeWorkItem(),
      spec,
      stateSource,
      'goose-hub-self',
      worktree,
      'impl-run-test-01',
      'escalate',
      {
        appendEvent,
        runTierImpl: async (tier, _spec, artifacts, tierDeps) => {
          const r = await runTier(
            tier,
            _spec,
            { ...artifacts, worktreePath: worktree },
            {
              ...tierDeps,
              runRegressionTestsImpl:
                tier === 3
                  ? async () => ({
                      passed: false,
                      failedTests: ['FAIL src/index.test.ts > regression'],
                    })
                  : undefined,
            },
          );
          return r;
        },
      },
    );

    expect(result.allPassed).toBe(false);
    expect(result.failedAtTier).toBe(3);

    const transition = vi.mocked(stateSource.transitionState);
    expect(transition).toHaveBeenCalledWith('562', 'factory:needs-qa', 'factory:needs-human');

    const regression = events.find((e) => (e.kind as string) === 'qa.regression-failed');
    expect(regression).toBeDefined();
  });

  it('does NOT escalate to needs-human when Tier 3 fails with ignore policy', async () => {
    const stateSource = makeStateSource();
    const { fn: appendEvent } = makeAppendEvent();

    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts'])],
      verificationTooling: [],
    });

    const result = await runThreeTierVerifyWorkflow(
      makeWorkItem(),
      spec,
      stateSource,
      'goose-hub-self',
      worktree,
      'impl-run-test-01',
      'ignore',
      {
        appendEvent,
        runTierImpl: async (tier, _spec, artifacts, tierDeps) =>
          runTier(
            tier,
            _spec,
            { ...artifacts, worktreePath: worktree },
            {
              ...tierDeps,
              runRegressionTestsImpl:
                tier === 3
                  ? async () => ({ passed: false, failedTests: ['FAIL test.ts > something'] })
                  : undefined,
            },
          ),
      },
    );

    // With 'ignore' policy, Tier 3 findings are warnings → treated as passed
    expect(result.allPassed).toBe(true);
    expect(vi.mocked(stateSource.transitionState)).not.toHaveBeenCalled();
  });
});

// ─── implRunId threading — carry-forward regression check ────────────────────
// Verifies the fix for Codex P1: workflow must use implRunId (not a fresh UUID)
// so verifyRegression can actually find wp_iterations rows from the impl run.

describe('runThreeTierVerifyWorkflow — implRunId threading', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), 'goose-hub-rid-'));
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src/index.ts'), 'export const x = 1;\n');
  });

  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  it('passes implRunId through to verifyRegression so wp_iterations queries see prior statuses', async () => {
    const capturedRunIds: string[] = [];
    const stateSource = makeStateSource();
    const { fn: appendEvent } = makeAppendEvent();

    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/index.ts'])],
      verificationTooling: [],
    });

    await runThreeTierVerifyWorkflow(
      makeWorkItem(),
      spec,
      stateSource,
      'goose-hub-self',
      worktree,
      'the-impl-run-id',
      'escalate',
      {
        appendEvent,
        runTierImpl: async (tier, _spec, artifacts, tierDeps) =>
          runTier(
            tier,
            _spec,
            { ...artifacts, worktreePath: worktree },
            {
              ...tierDeps,
              getLastWpStatusImpl: (runId, _wpId) => {
                capturedRunIds.push(runId);
                return null;
              },
              runRegressionTestsImpl: async () => ({ passed: true, failedTests: [] }),
            },
          ),
      },
    );

    // Tier 3 must have queried with the implRunId, not a fresh UUID
    expect(capturedRunIds.some((id) => id === 'the-impl-run-id')).toBe(true);
    expect(capturedRunIds.every((id) => id !== '')).toBe(true);
  });
});

// ─── runTier event emission ───────────────────────────────────────────────────

describe('runTier — event emission', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), 'goose-hub-ev-'));
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src/a.ts'), 'export const a = 1;\n');
  });

  afterEach(() => rmSync(worktree, { recursive: true, force: true }));

  it('emits qa.structural-passed on Tier-1 success', async () => {
    const { fn: appendEvent, events } = makeAppendEvent();
    const spec = makeSpec({ workPackages: [makeWp('WP1', ['src/a.ts'])] });

    const result = await runTier(
      1,
      spec,
      { runId: 'r1', projectId: 'p1', worktreePath: worktree },
      { appendEvent },
    );

    expect(result.passed).toBe(true);
    expect(events.find((e) => (e.kind as string) === 'qa.structural-passed')).toBeDefined();
  });

  it('emits qa.structural-failed on Tier-1 failure', async () => {
    const { fn: appendEvent, events } = makeAppendEvent();
    const spec = makeSpec({
      workPackages: [makeWp('WP1', ['src/a.ts'])],
      interfaceContracts: [
        {
          name: 'missingExport',
          signature: 'export function missingExport(): void',
          file: 'src/a.ts',
        },
      ],
    });

    const result = await runTier(
      1,
      spec,
      { runId: 'r1', projectId: 'p1', worktreePath: worktree },
      { appendEvent },
    );

    expect(result.passed).toBe(false);
    expect(events.find((e) => (e.kind as string) === 'qa.structural-failed')).toBeDefined();
  });
});
