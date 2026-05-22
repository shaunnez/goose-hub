import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { type EngineeringSpec, EngineeringSpecSchema, SpecAuthorSchema } from './schema.js';
import config, { SpecAuthorContextSchema } from './skill.config.js';
import { validateEngineeringSpec } from './validate.js';

function baseSpec(overrides: Partial<EngineeringSpec> = {}): EngineeringSpec {
  const base: EngineeringSpec = {
    objective: 'Add a /healthz endpoint and document its contract.',
    userJourneys: [
      {
        id: 'J1',
        actor: 'developer',
        steps: [{ idx: 0, description: 'GET /healthz observes 200 with body "ok"' }],
      },
    ],
    functionalRequirements: [{ id: 'FR1', statement: '/healthz returns 200 with body "ok"' }],
    architecture: {
      current: 'No health endpoint.',
      new: 'Add a Hono route at /healthz returning 200/"ok".',
      decisionRationale: 'Aligns with existing Hono routing in apps/server.',
    },
    schemaChanges: { ddl: [], migrations: [] },
    interfaceContracts: [
      {
        name: 'healthzHandler',
        signature: 'export const healthzHandler: Handler = (c) => c.text("ok");',
        file: 'apps/server/src/routes/healthz.ts',
      },
    ],
    workPackages: [
      {
        id: 'WP1',
        filesOwned: ['apps/server/src/routes/healthz.ts', 'apps/server/src/routes/healthz.test.ts'],
        changes:
          'Add a new file exporting healthzHandler bound to GET /healthz at line 1-12. Add test asserting 200 response.',
        dependsOn: [],
        builderTier: 'haiku',
      },
      {
        id: 'WP2',
        filesOwned: ['apps/server/src/router.ts', 'apps/server/src/router.test.ts'],
        changes:
          'Wire healthzHandler into router at app.get("/healthz", healthzHandler). Update router test.',
        dependsOn: ['WP1'],
        builderTier: 'haiku',
      },
    ],
    executionOrder: [
      { batch: 0, wpIds: ['WP1'] },
      { batch: 1, wpIds: ['WP2'] },
    ],
    verificationTooling: [],
    acceptanceCriteria: [
      {
        id: 'AC1',
        statement: 'GET /healthz returns 200 with body "ok"',
        journeyRef: 'J1',
        stepIdx: 0,
        verifyCommand: 'curl -fsS http://localhost:3000/healthz',
      },
    ],
    constraints: [],
    riskRegister: [],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Designed healthz endpoint as 1+1 WP split' }],
  };
  return { ...base, ...overrides };
}

describe('EngineeringSpecSchema (shape)', () => {
  it('accepts a fully-populated valid spec', () => {
    const result = EngineeringSpecSchema.safeParse(baseSpec());
    expect(result.success).toBe(true);
  });

  it('rejects empty workPackages', () => {
    const result = EngineeringSpecSchema.safeParse(baseSpec({ workPackages: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects empty acceptanceCriteria', () => {
    const result = EngineeringSpecSchema.safeParse(baseSpec({ acceptanceCriteria: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects WP with empty filesOwned', () => {
    const result = EngineeringSpecSchema.safeParse(
      baseSpec({
        workPackages: [
          {
            id: 'WP1',
            filesOwned: [],
            changes: 'irrelevant',
            dependsOn: [],
            builderTier: 'haiku',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown builderTier', () => {
    const parsed = EngineeringSpecSchema.safeParse(
      baseSpec({
        workPackages: [
          {
            id: 'WP1',
            filesOwned: ['a.ts'],
            changes: 'x',
            dependsOn: [],
            // @ts-expect-error — testing rejection
            builderTier: 'gpt-4',
          },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects empty AC verifyCommand (falsifiability rule)', () => {
    const result = EngineeringSpecSchema.safeParse(
      baseSpec({
        acceptanceCriteria: [
          {
            id: 'AC1',
            statement: 'works',
            journeyRef: 'J1',
            stepIdx: 0,
            verifyCommand: '',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts null optional leaf fields from AI output', () => {
    const result = EngineeringSpecSchema.safeParse({
      ...baseSpec(),
      interfaceContracts: [
        {
          ...baseSpec().interfaceContracts[0],
          lineRange: null,
        },
      ],
      verificationTooling: [
        {
          name: 'healthz-check',
          command: 'pnpm tsx scripts/check-healthz.ts',
          expectedExitCodes: [0],
          inputSpec: null,
        },
      ],
      acceptanceCriteria: [
        {
          id: 'AC1',
          statement: 'GET /healthz returns 200 with body "ok"',
          journeyRef: null,
          stepIdx: null,
          verifyCommand: 'curl -fsS http://localhost:3000/healthz',
          tolerance: null,
          crossCutting: null,
          source: null,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.interfaceContracts[0].lineRange).toBeNull();
    expect(result.data.verificationTooling[0].inputSpec).toBeNull();
    expect(result.data.acceptanceCriteria[0].journeyRef).toBeNull();
    expect(result.data.acceptanceCriteria[0].stepIdx).toBeNull();
    expect(result.data.acceptanceCriteria[0].tolerance).toBeNull();
    expect(result.data.acceptanceCriteria[0].crossCutting).toBeNull();
    expect(result.data.acceptanceCriteria[0].source).toBeNull();
  });

  it('keeps required spec-author contract fields strict against null', () => {
    const verifyCommand = EngineeringSpecSchema.safeParse({
      ...baseSpec(),
      acceptanceCriteria: [
        {
          ...baseSpec().acceptanceCriteria[0],
          verifyCommand: null,
        },
      ],
    });
    const schemaChanges = EngineeringSpecSchema.safeParse({
      ...baseSpec(),
      schemaChanges: null,
    });
    const interfaceContracts = EngineeringSpecSchema.safeParse({
      ...baseSpec(),
      interfaceContracts: null,
    });
    const constraints = EngineeringSpecSchema.safeParse({
      ...baseSpec(),
      constraints: null,
    });

    expect(verifyCommand.success).toBe(false);
    expect(schemaChanges.success).toBe(false);
    expect(interfaceContracts.success).toBe(false);
    expect(constraints.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = EngineeringSpecSchema.safeParse(baseSpec({ decisionSummaries: [] }));
    expect(result.success).toBe(false);
  });

  it('accepts SpecAuthorSchema as alias for EngineeringSpecSchema (backwards-compat)', () => {
    const result = SpecAuthorSchema.safeParse(baseSpec());
    expect(result.success).toBe(true);
  });

  it('accepts executable verification tooling commands', () => {
    const result = EngineeringSpecSchema.safeParse(
      baseSpec({
        verificationTooling: [
          {
            name: 'focused vitest',
            command: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
            expectedExitCodes: [0],
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('round-trips to JSON schema via zod-to-json-schema', () => {
    const json = toJSONSchema(EngineeringSpecSchema);
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
  });

  it('config exports the canonical Engineering Spec context shape', () => {
    expect(config.toolBundles).toEqual(['read']);
    expect(config.modelPin).toBe('sonnet');
    const ctx = SpecAuthorContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 559 },
      issueType: 'feature',
      prdContext: {
        source: 'event',
        parentWorkItemId: 'github:owner/repo#1',
        prdRunId: 'prd-run',
        title: 'PRD',
        problem: 'Problem',
        proposedSolution: 'Solution',
        successCriteria: ['Works'],
        acceptanceCriteria: [{ id: 'AC1', statement: 'Works' }],
        journeys: [],
        verticalSlices: [],
        implementationDecisions: [],
        testingDecisions: null,
      },
    });
    expect(ctx.success).toBe(true);
  });
});

describe('validateEngineeringSpec — hard rules', () => {
  it('passes a clean spec', () => {
    const result = validateEngineeringSpec(baseSpec());
    expect(result.ok).toBe(true);
  });

  it('rejects file-ownership-collision (same path in two WPs, even across batches)', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['apps/server/src/router.ts'],
          changes: 'edit router.ts to register /healthz',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          // SAME PATH — across batches.
          filesOwned: ['apps/server/src/router.ts'],
          changes: 'edit router.ts to register /readyz',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
      // Make the spec otherwise self-consistent
      interfaceContracts: [
        {
          name: 'noop',
          signature: 'export const noop = () => {};',
          file: 'apps/server/src/router.ts',
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'file-ownership-collision')).toBe(true);
  });

  it('rejects AC without journeyRef when issueType=feature (ac-orphan-without-journey)', () => {
    const spec = baseSpec({
      acceptanceCriteria: [
        {
          id: 'AC1',
          statement: 'orphan ac',
          verifyCommand: 'echo ok',
          // no journeyRef, no crossCutting
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'ac-orphan-without-journey')).toBe(true);
  });

  it('accepts orphan AC when crossCutting: true', () => {
    const spec = baseSpec({
      acceptanceCriteria: [
        ...baseSpec().acceptanceCriteria,
        {
          id: 'AC-CROSS',
          statement: 'budget cap is enforced',
          verifyCommand: 'pnpm test core/cost',
          crossCutting: true,
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(true);
  });

  it('treats orphan AC as advisory when issueType=bug', () => {
    const spec = baseSpec({
      acceptanceCriteria: [
        {
          id: 'AC1',
          statement: 'orphan ac',
          verifyCommand: 'echo ok',
        },
      ],
    });
    const result = validateEngineeringSpec(spec, { issueType: 'bug' });
    expect(result.ok).toBe(true);
  });

  it('rejects ac-journey-ref-not-found when journeyRef points at unknown journey', () => {
    const spec = baseSpec({
      acceptanceCriteria: [
        {
          id: 'AC1',
          statement: 's',
          verifyCommand: 'echo ok',
          journeyRef: 'J-UNKNOWN',
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'ac-journey-ref-not-found')).toBe(true);
  });

  it('rejects ac-step-idx-out-of-range when stepIdx is not a real step', () => {
    const spec = baseSpec({
      acceptanceCriteria: [
        {
          id: 'AC1',
          statement: 's',
          verifyCommand: 'echo ok',
          journeyRef: 'J1',
          stepIdx: 99,
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'ac-step-idx-out-of-range')).toBe(true);
  });

  it('rejects when sensitive path (auth) is touched but riskRegister is empty', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['core/auth/normalise-email.ts'],
          changes: 'fix plus-sign decode at line 87',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: ['core/auth/types.ts'],
          changes: 'export NormalisedEmail type',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
      interfaceContracts: [
        {
          name: 'NormalisedEmail',
          signature: 'export type NormalisedEmail = string & { __brand: "ne" };',
          file: 'core/auth/types.ts',
        },
      ],
      riskRegister: [], // empty even though auth is touched
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'risk-required-on-sensitive-path')).toBe(true);
  });

  it('rejects malformed constraint source (constraint-source-format)', () => {
    const spec = baseSpec({
      constraints: [{ kind: 'phase', name: 'in-flight', source: 'not-a-real-format' }],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'constraint-source-format')).toBe(true);
  });

  it('rejects wp-dependson-not-found when dependsOn references unknown WP', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['a.ts'],
          changes: 'change a',
          dependsOn: ['WP-DOES-NOT-EXIST'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
      // Single-WP spec — no interface contracts needed.
      interfaceContracts: [],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'wp-dependson-not-found')).toBe(true);
  });

  it('rejects execution-order-wp-mismatch when WP missing from executionOrder', () => {
    const spec = baseSpec({
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }], // WP2 is missing
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'execution-order-wp-mismatch')).toBe(true);
  });

  it('rejects self-check-journey-coverage when a journey step has no AC', () => {
    const spec = baseSpec({
      userJourneys: [
        {
          id: 'J1',
          actor: 'developer',
          steps: [
            { idx: 0, description: 'a' },
            { idx: 1, description: 'b' },
            { idx: 2, description: 'uncovered step' },
          ],
        },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'self-check-journey-coverage')).toBe(true);
  });

  it('rejects self-check-complete-interfaces when ≥2 WPs but no interfaceContracts', () => {
    const spec = baseSpec({
      interfaceContracts: [], // 2 WPs above; no contracts
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'self-check-complete-interfaces')).toBe(true);
  });

  it('rejects self-check-verification-tooling when >2 WPs but no verificationTooling', () => {
    const spec = baseSpec({
      workPackages: [
        ...baseSpec().workPackages,
        {
          id: 'WP3',
          filesOwned: ['apps/server/src/routes/readyz.ts'],
          changes: 'add /readyz route, mirror healthz',
          dependsOn: [],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1', 'WP3'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'self-check-verification-tooling')).toBe(true);
  });

  it('rejects verification tooling commands that are bare repo-relative file paths', () => {
    const result = validateEngineeringSpec(
      baseSpec({
        verificationTooling: [
          {
            name: 'bad focused test',
            command: 'apps/web/src/foo.test.ts',
            expectedExitCodes: [0],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        rule: 'verification-tool-command-malformed',
        ref: 'verificationTooling[0].command',
      }),
    );
  });

  it('rejects self-check-builder-independence when WP changes is too short', () => {
    const wp2 = baseSpec().workPackages[1];
    if (wp2 === undefined) throw new Error('baseSpec must have ≥2 WPs');
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['a.ts'],
          changes: 'fix', // way too short
          dependsOn: [],
          builderTier: 'haiku',
        },
        wp2,
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'self-check-builder-independence')).toBe(true);
  });
});

describe('validateEngineeringSpec — repoRoot-backed checks', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'spec-author-test-'));
    // Pre-create a couple of files for grounding checks.
    mkdirSync(join(tmpRepo, 'apps/server/src/routes'), { recursive: true });
    writeFileSync(
      join(tmpRepo, 'apps/server/src/routes/healthz.ts'),
      'export const healthzHandler = () => "ok";\n',
    );
    writeFileSync(
      join(tmpRepo, 'apps/server/src/router.ts'),
      "import { healthzHandler } from './routes/healthz.js';\n",
    );
  });

  afterEach(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('passes a clean spec when constraint sources point at real files+symbols', () => {
    const spec = baseSpec({
      constraints: [
        {
          kind: 'phase',
          name: 'healthz endpoint',
          source: 'apps/server/src/routes/healthz.ts:healthzHandler',
        },
      ],
    });
    const result = validateEngineeringSpec(spec, { repoRoot: tmpRepo });
    expect(result.ok).toBe(true);
  });

  it('rejects constraint-source-file-missing when the cited file does not exist', () => {
    const spec = baseSpec({
      constraints: [
        {
          kind: 'phase',
          name: 'fictional',
          source: 'apps/server/src/routes/notreal.ts:42',
        },
      ],
    });
    const result = validateEngineeringSpec(spec, { repoRoot: tmpRepo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'constraint-source-file-missing')).toBe(true);
  });

  it('rejects constraint-source-symbol-missing when the cited symbol is absent', () => {
    const spec = baseSpec({
      constraints: [
        {
          kind: 'model',
          name: 'unknown handler',
          source: 'apps/server/src/routes/healthz.ts:nonexistentSymbol',
        },
      ],
    });
    const result = validateEngineeringSpec(spec, { repoRoot: tmpRepo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'constraint-source-symbol-missing')).toBe(true);
  });

  it('rejects package-relative verification command path arguments', () => {
    mkdirSync(join(tmpRepo, 'apps/web/scripts'), { recursive: true });
    writeFileSync(join(tmpRepo, 'apps/web/scripts/check.ts'), 'export {};\n');
    const spec = baseSpec({
      constraints: [
        {
          kind: 'phase',
          name: 'healthz endpoint',
          source: 'apps/server/src/routes/healthz.ts:healthzHandler',
        },
      ],
      verificationTooling: [
        {
          name: 'web check',
          command: 'pnpm tsx scripts/check.ts',
          expectedExitCodes: [0],
        },
      ],
    });

    const result = validateEngineeringSpec(spec, { repoRoot: tmpRepo });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        rule: 'verification-tool-command-package-relative',
        ref: 'verificationTooling[0].command',
      }),
    );
  });
});

// ─── TDD contract: wp-missing-test-file ──────────────────────────────────────

describe('validateEngineeringSpec — TDD contract (wp-missing-test-file)', () => {
  it('documents TDD ownership in the spec-author prompt', () => {
    const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

    expect(prompt).toContain('#### TDD ownership');
    expect(prompt).toContain('production `.ts` or `.tsx` files');
    expect(prompt).toContain('`*.test.ts`');
    expect(prompt).toContain('`*.spec.ts`');
    expect(prompt).toContain('Do not put the test file only in `verificationTooling`');
    expect(prompt).toContain('Test-only WPs are allowed');
  });

  it('rejects WP with production .ts files but no test file', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['core/tool-layer/sandbox.ts'],
          changes: 'Add WP_BASH_DENYLIST applied in writeWpBuilderSandbox to block risky bash.',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: ['core/tool-layer/slice.test.ts'],
          changes: 'Add tests for WP_BASH_DENYLIST entries in writeWpBuilderSandbox output.',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.rule === 'wp-missing-test-file')).toBe(true);
    const err = result.errors.find((e) => e.rule === 'wp-missing-test-file');
    expect(err?.ref).toBe('WP1');
  });

  it('accepts WP that owns both source and test file', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['core/tool-layer/sandbox.ts', 'core/tool-layer/slice.test.ts'],
          changes: 'Add WP_BASH_DENYLIST and tests for it.',
          dependsOn: [],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
      interfaceContracts: [],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(true);
  });

  it('accepts WP that owns only a test file (test-only WP)', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['apps/server/src/routes/healthz.ts', 'core/tool-layer/slice.test.ts'],
          changes: 'Add healthz route and wire up existing test coverage.',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: ['apps/server/src/router.ts'],
          changes: 'Wire healthzHandler into router.',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    // WP2 owns router.ts but no test file — should fire
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.rule === 'wp-missing-test-file');
    expect(err?.ref).toBe('WP2');
  });

  it('does not flag WP that owns only config/schema/types files', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['apps/server/src/routes/healthz.ts', 'core/tool-layer/slice.test.ts'],
          changes: 'Add healthz and tests.',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: ['core/agent-runtime/interface.ts'],
          changes: 'Add sandboxMode field to AgentSpec.',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    // WP2 owns interface.ts (types-only, exempt). WP1 owns source + test, ok.
    const result = validateEngineeringSpec(spec);
    const testFileErrors = (result.ok ? [] : result.errors).filter(
      (e) => e.rule === 'wp-missing-test-file',
    );
    expect(testFileErrors).toHaveLength(0);
  });

  it('flags WP with .tsx production file but no test file', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: [
            'apps/server/src/routes/healthz.ts',
            'apps/server/src/routes/healthz.test.ts',
          ],
          changes: 'Add healthz route and test.',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: ['apps/web/src/components/HealthBadge.tsx'],
          changes: 'Add HealthBadge component displaying /healthz status.',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    const result = validateEngineeringSpec(spec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const err = result.errors.find((e) => e.rule === 'wp-missing-test-file');
    expect(err?.ref).toBe('WP2');
  });

  it('accepts WP with .tsx production file when test.tsx is also owned', () => {
    const spec = baseSpec({
      workPackages: [
        {
          id: 'WP1',
          filesOwned: [
            'apps/server/src/routes/healthz.ts',
            'apps/server/src/routes/healthz.test.ts',
          ],
          changes: 'Add healthz route and test.',
          dependsOn: [],
          builderTier: 'haiku',
        },
        {
          id: 'WP2',
          filesOwned: [
            'apps/web/src/components/HealthBadge.tsx',
            'apps/web/src/components/HealthBadge.test.tsx',
          ],
          changes: 'Add HealthBadge component and test.',
          dependsOn: ['WP1'],
          builderTier: 'haiku',
        },
      ],
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    });
    const result = validateEngineeringSpec(spec);
    const testFileErrors = (result.ok ? [] : result.errors).filter(
      (e) => e.rule === 'wp-missing-test-file',
    );
    expect(testFileErrors).toHaveLength(0);
  });
});
