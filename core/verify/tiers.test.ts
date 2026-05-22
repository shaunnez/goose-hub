// core/verify/tiers.test.ts
// Pure-tier verification engine tests. Migrated from the now-deleted
// `slices/three-tier-verify/` slice as part of M19.19 (issue #695).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { runTier, verifyFunctional, verifyRegression, verifyStructural } from './tiers.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Tier 1: Structural ──────────────────────────────────────────────────────

describe('Tier 1 (Structural) — golden test', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), 'goose-hub-t1-'));
    mkdirSync(join(worktree, 'src'), { recursive: true });
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

// ─── Tier 2: Functional ──────────────────────────────────────────────────────

describe('Tier 2 (Functional) — golden test', () => {
  it('fails when a verification command exits with unexpected code', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'import-smoke',
          command: 'node -e "require(\'./broken\')"',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationCommandImpl: async (_command, _cwd, expectedExitCodes) => ({
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
        { name: 'lint', command: 'pnpm lint', expectedExitCodes: [0] },
        { name: 'typecheck', command: 'pnpm typecheck', expectedExitCodes: [0] },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationCommandImpl: async () => ({ passed: true, output: '' }),
    });

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(2);
  });

  it('normalizes root web Playwright chat commands to the web package runner', async () => {
    const commands: string[] = [];
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'chat reopen regression e2e',
          command:
            'pnpm exec playwright test apps/web/e2e/chat.spec.ts --grep "reopens on the conversation list after launcher close"',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationCommandImpl: async (command) => {
        commands.push(command);
        return { passed: true, output: '' };
      },
    });

    expect(result.passed).toBe(true);
    expect(commands).toEqual([
      'pnpm --filter @goose-hub/web exec playwright test --config playwright-chat.config.ts e2e/chat.spec.ts --grep "reopens on the conversation list after launcher close"',
    ]);
  });

  it('classifies a bare test file path as verification infrastructure failure', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'bad-path',
          command: 'apps/web/src/foo.test.ts',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp');

    expect(result.passed).toBe(false);
    expect(result.findings[0]?.category).toBe('verification-infrastructure');
    expect(result.findings[0]?.code).toBe('malformed-verification-command');
  });

  it('classifies missing command on malformed persisted specs as verification infrastructure', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'old persisted verifier',
          scriptPath: 'apps/web/src/foo.test.ts',
          expectedExitCodes: [0],
        } as unknown as EngineeringSpec['verificationTooling'][number],
      ],
    });

    const result = await verifyFunctional(spec, '/tmp');

    expect(result.passed).toBe(false);
    expect(result.findings[0]?.category).toBe('verification-infrastructure');
    expect(result.findings[0]?.code).toBe('malformed-verification-command');
  });

  it('does not classify product ENOENT output as verification infrastructure', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'focused test',
          command: 'pnpm vitest run src/foo.test.ts',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationCommandImpl: async () => ({
        passed: false,
        output: "Error: ENOENT: no such file or directory, open 'missing-product-file.json'",
      }),
    });

    expect(result.passed).toBe(false);
    expect(result.findings[0]?.category).toBe('product');
  });

  it('classifies command launcher missing as verification infrastructure', async () => {
    const spec = makeSpec({
      verificationTooling: [
        {
          name: 'focused test',
          command: 'pnpm vitest run src/foo.test.ts',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = await verifyFunctional(spec, '/tmp', {
      runVerificationCommandImpl: async () => ({
        passed: false,
        output: 'sh: pnpm: command not found',
      }),
    });

    expect(result.passed).toBe(false);
    expect(result.findings[0]?.category).toBe('verification-infrastructure');
    expect(result.findings[0]?.code).toBe('verification-runner-missing');
  });

  it('passes vacuously when no verificationTooling is declared', async () => {
    const spec = makeSpec({ verificationTooling: [] });
    const result = await verifyFunctional(spec, '/tmp');

    expect(result.passed).toBe(true);
    expect(result.evidence).toContain('no-verification-tooling-declared');
  });
});

// ─── Tier 3: Regression ──────────────────────────────────────────────────────

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

// ─── runTier event emission ──────────────────────────────────────────────────

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
    const event = events.find((e) => (e.kind as string) === 'qa.structural-passed');
    expect(event).toBeDefined();
    expect(event?.payload).toMatchObject({
      tier: 'structural',
      tierNumber: 1,
      evidence: expect.any(Array),
      findingCount: 0,
      runId: 'r1',
    });
    expect(result.tier).toBe(1);
  });

  it('emits named public tier payloads for Tier-2 and Tier-3 success', async () => {
    const { fn: appendEvent, events } = makeAppendEvent();
    const spec = makeSpec({ workPackages: [makeWp('WP1', ['src/a.ts'])] });
    const artifacts = { runId: 'r1', projectId: 'p1', worktreePath: worktree };

    const functional = await runTier(2, spec, artifacts, { appendEvent });
    const regression = await runTier(3, spec, artifacts, {
      appendEvent,
      runRegressionTestsImpl: async () => ({ passed: true, failedTests: [] }),
    });

    expect(functional.tier).toBe(2);
    expect(regression.tier).toBe(3);
    expect(
      events.find((e) => (e.kind as string) === 'qa.functional-passed')?.payload,
    ).toMatchObject({
      tier: 'functional',
      tierNumber: 2,
      evidence: expect.any(Array),
      findingCount: 0,
      runId: 'r1',
    });
    expect(
      events.find((e) => (e.kind as string) === 'qa.regression-passed')?.payload,
    ).toMatchObject({
      tier: 'regression',
      tierNumber: 3,
      evidence: expect.any(Array),
      findingCount: 0,
      runId: 'r1',
    });
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
    const event = events.find((e) => (e.kind as string) === 'qa.structural-failed');
    expect(event).toBeDefined();
    expect(event?.payload).toMatchObject({
      tier: 'structural',
      tierNumber: 1,
      evidence: expect.any(Array),
      findingCount: 1,
      runId: 'r1',
    });
    expect(result.tier).toBe(1);
  });
});
