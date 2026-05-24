import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import {
  CriteriaResultSchema,
  FindingSchema,
  QaOutputSchema,
  QualityScoresSchema,
  TierResultSchema,
  VerificationSummarySchema,
  computeOverallScore,
} from './schema.js';
import config, { QaContextSchema } from './skill.config.js';

// ─── Helper: minimal valid QaOutput ─────────────────────────────────────────

function makeValidScores() {
  return {
    openClosed: 15,
    conceptCount: 10,
    timeToCapability: 10,
    complecting: 10,
    loc: 8,
    coupling: 8,
    gallsLaw: 8,
    cyclomaticComplexity: 4,
  };
}

function makeValidTierResult() {
  return { passed: true, findings: [] };
}

function makeValidOutput(overrides = {}) {
  return {
    verdict: 'pass',
    overallScore: 73,
    tierResults: {
      structural: makeValidTierResult(),
      functional: makeValidTierResult(),
      regression: makeValidTierResult(),
    },
    qualityScores: makeValidScores(),
    findings: [],
    decisionSummaries: [{ kind: 'STRUCTURAL_CHECK', summary: 'All lint and type-check passed' }],
    ...overrides,
  };
}

// ─── QaOutputSchema ──────────────────────────────────────────────────────────

describe('QaOutputSchema', () => {
  it('accepts a valid pass result', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ verdict: 'pass' }));
    expect(result.success).toBe(true);
  });

  it('accepts a valid fail result', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        verdict: 'fail',
        overallScore: 45,
        findings: [
          {
            tier: 'structural',
            severity: 'error',
            description: 'TypeScript error: Type "string" is not assignable to type "number"',
            disposition: 'registered',
            dispositionRef: '#999',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a valid partial result', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        verdict: 'partial',
        overallScore: 65,
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: {
            passed: false,
            findings: [
              {
                tier: 'functional',
                severity: 'error',
                description: 'Test failed',
                disposition: 'fixed',
                dispositionRef: 'abc1234',
              },
            ],
          },
          regression: { passed: false, findings: [] },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ verdict: 'unknown' }));
    expect(result.success).toBe(false);
  });

  it('rejects missing verdict', () => {
    const { verdict: _v, ...rest } = makeValidOutput();
    const result = QaOutputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects overallScore above 100', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ overallScore: 101 }));
    expect(result.success).toBe(false);
  });

  it('rejects overallScore below 0', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ overallScore: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects overallScore that is not an integer', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ overallScore: 72.5 }));
    expect(result.success).toBe(false);
  });

  it('rejects missing tierResults', () => {
    const { tierResults: _t, ...rest } = makeValidOutput();
    const result = QaOutputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing qualityScores', () => {
    const { qualityScores: _q, ...rest } = makeValidOutput();
    const result = QaOutputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('defaults threshold to 70 when not provided', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(70);
    }
  });

  it('accepts explicit threshold value', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ threshold: 80 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(80);
    }
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(QaOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

// ─── DecisionSummarySchema (shared kind enum, #466) ─────────────────────────

describe('QaOutputSchema decision-kind enum', () => {
  it('accepts a known-good output with valid kinds across the verification flow', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        decisionSummaries: [
          { kind: 'STRUCTURAL_CHECK', summary: 'biome and tsc clean' },
          { kind: 'FUNCTIONAL_CHECK', summary: 'all tests pass' },
          { kind: 'VERDICT', summary: 'pass' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a decisionSummaries entry with an invalid kind', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        decisionSummaries: [{ kind: 'made-up-kind', summary: 'x' }],
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ─── FindingSchema ───────────────────────────────────────────────────────────

describe('FindingSchema', () => {
  it('accepts a minimal structural finding (warning severity, no disposition required)', () => {
    const result = FindingSchema.safeParse({
      tier: 'structural',
      severity: 'warning',
      description: 'Biome lint warning: missing semicolon',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a functional finding with optional fields', () => {
    const result = FindingSchema.safeParse({
      tier: 'functional',
      severity: 'warning',
      file: 'src/core/something.ts',
      line: 42,
      description: 'Test assertion failed',
      suggestion: 'Check the return value of computeX()',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a regression finding', () => {
    const result = FindingSchema.safeParse({
      tier: 'regression',
      severity: 'info',
      description: 'Playwright test skipped due to flaky selector',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tier', () => {
    const result = FindingSchema.safeParse({
      tier: 'performance',
      severity: 'error',
      description: 'Some issue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = FindingSchema.safeParse({
      tier: 'structural',
      severity: 'critical',
      description: 'Some issue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = FindingSchema.safeParse({ tier: 'structural', severity: 'error' });
    expect(result.success).toBe(false);
  });

  it('accepts null file and null line for findings without a source location', () => {
    const result = FindingSchema.safeParse({
      tier: 'functional',
      severity: 'warning',
      file: null,
      line: null,
      description: 'Acceptance criterion 3 not covered by any test',
    });
    expect(result.success).toBe(true);
  });

  // ── #468 — fix-or-register disposition ────────────────────────────────────

  it("accepts an error finding with disposition 'fixed' and a commit SHA dispositionRef (#468)", () => {
    expect(
      FindingSchema.safeParse({
        tier: 'functional',
        severity: 'error',
        description: 'Off-by-one in pagination',
        disposition: 'fixed',
        dispositionRef: 'abc123def',
      }).success,
    ).toBe(true);
  });

  it("accepts an error finding with disposition 'registered' and an issue number (#468)", () => {
    expect(
      FindingSchema.safeParse({
        tier: 'structural',
        severity: 'error',
        description: 'Missing slice.test.ts',
        disposition: 'registered',
        dispositionRef: '#234',
      }).success,
    ).toBe(true);
  });

  it("accepts an error finding with disposition 'out-of-scope' and a rationale (#468)", () => {
    expect(
      FindingSchema.safeParse({
        tier: 'regression',
        severity: 'error',
        description: 'E2e flake outside this slice',
        disposition: 'out-of-scope',
        dispositionRef: 'pre-existing flake unrelated to this PR; tracked separately',
      }).success,
    ).toBe(true);
  });

  it('rejects an error finding without a disposition (#468)', () => {
    expect(
      FindingSchema.safeParse({
        tier: 'functional',
        severity: 'error',
        description: 'broken thing',
      }).success,
    ).toBe(false);
  });

  it('rejects an error finding with disposition but empty dispositionRef (#468)', () => {
    expect(
      FindingSchema.safeParse({
        tier: 'functional',
        severity: 'error',
        description: 'broken thing',
        disposition: 'registered',
        dispositionRef: '',
      }).success,
    ).toBe(false);
  });

  it('warning-severity findings do not require disposition (#468)', () => {
    expect(
      FindingSchema.safeParse({
        tier: 'functional',
        severity: 'warning',
        description: 'AC 3 not covered by a dedicated test',
      }).success,
    ).toBe(true);
  });

  it('warning-severity findings may carry an optional disposition (#468)', () => {
    expect(
      FindingSchema.safeParse({
        tier: 'functional',
        severity: 'warning',
        description: 'minor naming nit',
        disposition: 'out-of-scope',
        dispositionRef: 'naming convention is the subject of a separate refactor',
      }).success,
    ).toBe(true);
  });

  // ── #697 — priority field on findings ─────────────────────────────────────

  it('accepts an explicit priority on a finding (#697)', () => {
    const result = FindingSchema.safeParse({
      tier: 'functional',
      severity: 'error',
      description: 'broken behaviour',
      disposition: 'fixed',
      dispositionRef: 'abc123',
      priority: 'P0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('P0');
    }
  });

  it('treats priority as optional — omitting it does not fail validation (#697)', () => {
    const result = FindingSchema.safeParse({
      tier: 'structural',
      severity: 'warning',
      description: 'lint nit',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid priority literal (#697)', () => {
    const result = FindingSchema.safeParse({
      tier: 'structural',
      severity: 'warning',
      description: 'lint nit',
      priority: 'p4',
    });
    expect(result.success).toBe(false);
  });
});

// ─── TierResultSchema ────────────────────────────────────────────────────────

describe('TierResultSchema', () => {
  it('accepts a passing tier with no findings', () => {
    const result = TierResultSchema.safeParse({ passed: true, findings: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a failing tier with findings and optional command/output', () => {
    const result = TierResultSchema.safeParse({
      passed: false,
      findings: [
        {
          tier: 'structural',
          severity: 'error',
          description: 'lint error',
          disposition: 'fixed',
          dispositionRef: 'abc123',
        },
      ],
      command: 'pnpm biome check .',
      output: 'error: missing semicolon',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing passed field', () => {
    const result = TierResultSchema.safeParse({ findings: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing findings field', () => {
    const result = TierResultSchema.safeParse({ passed: true });
    expect(result.success).toBe(false);
  });
});

// ─── QualityScoresSchema ─────────────────────────────────────────────────────

describe('QualityScoresSchema', () => {
  it('accepts all max values', () => {
    const result = QualityScoresSchema.safeParse({
      openClosed: 20,
      conceptCount: 15,
      timeToCapability: 15,
      complecting: 15,
      loc: 10,
      coupling: 10,
      gallsLaw: 10,
      cyclomaticComplexity: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all zero values', () => {
    const result = QualityScoresSchema.safeParse({
      openClosed: 0,
      conceptCount: 0,
      timeToCapability: 0,
      complecting: 0,
      loc: 0,
      coupling: 0,
      gallsLaw: 0,
      cyclomaticComplexity: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects openClosed above 20', () => {
    const result = QualityScoresSchema.safeParse({ ...makeValidScores(), openClosed: 21 });
    expect(result.success).toBe(false);
  });

  it('rejects conceptCount above 15', () => {
    const result = QualityScoresSchema.safeParse({ ...makeValidScores(), conceptCount: 16 });
    expect(result.success).toBe(false);
  });

  it('rejects cyclomaticComplexity above 5', () => {
    const result = QualityScoresSchema.safeParse({ ...makeValidScores(), cyclomaticComplexity: 6 });
    expect(result.success).toBe(false);
  });

  it('rejects negative values', () => {
    const result = QualityScoresSchema.safeParse({ ...makeValidScores(), loc: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer values', () => {
    const result = QualityScoresSchema.safeParse({ ...makeValidScores(), coupling: 7.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing field', () => {
    const { gallsLaw: _g, ...rest } = makeValidScores();
    const result = QualityScoresSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── computeOverallScore ─────────────────────────────────────────────────────

describe('computeOverallScore', () => {
  it('returns 100 for all maximum scores', () => {
    const scores = {
      openClosed: 20,
      conceptCount: 15,
      timeToCapability: 15,
      complecting: 15,
      loc: 10,
      coupling: 10,
      gallsLaw: 10,
      cyclomaticComplexity: 5,
    };
    expect(computeOverallScore(scores)).toBe(100);
  });

  it('returns 0 for all zero scores', () => {
    const scores = {
      openClosed: 0,
      conceptCount: 0,
      timeToCapability: 0,
      complecting: 0,
      loc: 0,
      coupling: 0,
      gallsLaw: 0,
      cyclomaticComplexity: 0,
    };
    expect(computeOverallScore(scores)).toBe(0);
  });

  it('sums all category scores correctly', () => {
    const scores = makeValidScores();
    // 15 + 10 + 10 + 10 + 8 + 8 + 8 + 4 = 73
    expect(computeOverallScore(scores)).toBe(73);
  });

  it('returns a score at the pass threshold (70)', () => {
    const scores = {
      openClosed: 14,
      conceptCount: 10,
      timeToCapability: 10,
      complecting: 10,
      loc: 8,
      coupling: 8,
      gallsLaw: 8,
      cyclomaticComplexity: 2,
    };
    expect(computeOverallScore(scores)).toBe(70);
  });

  it('returns a score below the pass threshold (69)', () => {
    const scores = {
      openClosed: 13,
      conceptCount: 10,
      timeToCapability: 10,
      complecting: 10,
      loc: 8,
      coupling: 8,
      gallsLaw: 8,
      cyclomaticComplexity: 2,
    };
    expect(computeOverallScore(scores)).toBe(69);
  });
});

// ─── QA skill config ─────────────────────────────────────────────────────────

describe('qa skill config', () => {
  it('has role qa', () => {
    expect(config.role).toBe('qa');
  });

  it('has freshContext: true (holdout requirement)', () => {
    expect(config.freshContext).toBe(true);
  });

  it('uses the QA tool bundle for read-only verification', () => {
    expect(config.toolBundles).toContain('qa-tools');
  });

  it('contextAllowlist contains workItem', () => {
    expect(config.contextAllowlist).toContain('workItem');
  });

  it('contextAllowlist contains prDiff', () => {
    expect(config.contextAllowlist).toContain('prDiff');
  });

  it('contextAllowlist contains prDiffWithContext', () => {
    expect(config.contextAllowlist).toContain('prDiffWithContext');
  });

  it('contextAllowlist contains projectCommands', () => {
    expect(config.contextAllowlist).toContain('projectCommands');
  });

  it('contextAllowlist does NOT contain devDecisionSummaries', () => {
    expect(config.contextAllowlist).not.toContain('devDecisionSummaries');
  });

  it('contextAllowlist does NOT contain investigationFindings', () => {
    expect(config.contextAllowlist).not.toContain('investigationFindings');
  });

  it('contextSchema validates required workItem, prDiff and projectCommands', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'Fix auth bug', body: 'Auth breaks on login.', number: 42 },
      prDiff: 'diff --git a/src/foo.ts b/src/foo.ts\n...',
      prDiffWithContext: {
        changedFiles: ['src/foo.ts'],
        hunkCount: 1,
        hunks: [{ file: 'src/foo.ts', oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 }],
        diffCharCount: 42,
      },
      projectCommands: { testCommand: 'pnpm test ', lintCommand: 'pnpm biome check .' },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts optional sliceTests', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff output here',
      projectCommands: { testCommand: 'pnpm test ' },
      sliceTests: ['skills/qa/slice.test.ts'],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem', () => {
    const invalid = QaContextSchema.safeParse({
      prDiff: 'diff output',
      projectCommands: { testCommand: 'pnpm test ' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing prDiff', () => {
    const invalid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      projectCommands: { testCommand: 'pnpm test ' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing projectCommands', () => {
    const invalid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff output',
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.number', () => {
    const invalid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body' },
      prDiff: 'diff output',
      projectCommands: { testCommand: 'pnpm test ' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema accepts optional criteriaResults array', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test ' },
      criteriaResults: [
        {
          criterionId: 'AC-1',
          checkId: 'AC-1-check-1',
          ac: 'Loader returns two projects',
          command: 'pnpm test ',
          expectedExitCodes: [0],
          exitCode: 0,
          actual: '2 tests passed',
          outputExpectation: { mode: 'contains', value: '2 tests passed' },
          passed: true,
        },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts empty criteriaResults array', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test ' },
      criteriaResults: [],
    });
    expect(valid.success).toBe(true);
  });

  it('contextAllowlist contains criteriaResults', () => {
    expect(config.contextAllowlist).toContain('criteriaResults');
  });

  it('contextAllowlist contains devTestsRun (#467)', () => {
    expect(config.contextAllowlist).toContain('devTestsRun');
  });

  it('contextAllowlist contains verificationSummary', () => {
    expect(config.contextAllowlist).toContain('verificationSummary');
  });

  it('contextSchema accepts compact verificationSummary', () => {
    const verificationSummary = {
      changedFiles: {
        paths: ['slices/qa/workflow.ts'],
        count: 1,
        diffCharCount: 1024,
        diffStat: 'slices/qa/workflow.ts | 10 +++++-----',
      },
      pr: { number: 813, baseBranch: 'main', headSha: 'abc1234' },
      commands: {
        lint: { command: 'pnpm lint', status: 'passed' },
        typecheck: { command: 'pnpm typecheck', status: 'passed' },
        test: { command: 'pnpm test --reporter=json', status: 'passed', durationMs: 1000 },
      },
      testRun: {
        command: 'pnpm test --reporter=json',
        status: 'passed',
        wallTimeMs: 1000,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        failingSuites: [],
      },
      e2e: { mode: 'ui-changed', status: 'skipped', reason: 'no significant UI changes detected' },
      evidence: { status: 'absent' },
      devTestsRun: {
        command: 'pnpm vitest slices/qa/slice.test.ts',
        paths: ['slices/qa/slice.test.ts'],
      },
    };

    expect(VerificationSummarySchema.safeParse(verificationSummary).success).toBe(true);
    const valid = QaContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test ' },
      verificationSummary,
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts devTestsRun with command and paths (#467)', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 't', body: 'b', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test ' },
      devTestsRun: {
        command: 'pnpm test ',
        paths: ['core/foo/bar.test.ts', 'core/foo/baz.test.ts'],
      },
    });
    expect(valid.success).toBe(true);
  });
});

describe('qa prompt verificationSummary guidance', () => {
  it('tells QA not to rerun the full suite when structured test results are present', () => {
    const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

    expect(prompt).toContain('Start from `verificationSummary`');
    expect(prompt).toContain(
      'Do not re-run `testCommand` when structured test results are present',
    );
    expect(prompt).toContain(
      'If `verificationSummary.e2e.status` is `passed` or `failed`, grade Regression from that structured result and do not re-run e2e',
    );
    expect(prompt).toContain(
      'One-off visual evidence specs under `apps/web/e2e/issue-<number>.spec.ts` are evidence-post inputs, not durable pipeline coverage',
    );
    expect(prompt).toContain('Inspect changed files first');
  });
});

describe('qa prompt live decisions', () => {
  it('uses record_decision as the primary live timeline signal', () => {
    const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

    expect(prompt).toContain('mcp__factory-tools__record_decision');
    expect(prompt).toContain('The tool call is the primary live timeline signal');
    expect(prompt).toContain('do not rely on text markers alone');
  });
});

// ─── #467 — full-suite-fails-outside-dev-paths produces an error finding ─────

describe('QaOutputSchema with cross-checked targeted regressions (#467)', () => {
  it('records an error-severity finding when a full-suite failure is outside dev testsRun.paths', () => {
    const errFinding = {
      tier: 'functional' as const,
      severity: 'error' as const,
      file: 'apps/server/src/unrelated/auth.test.ts',
      description:
        'Failure outside dev targeted set (devTestsRun.paths) — high-signal regression dev did not run',
      disposition: 'registered' as const,
      dispositionRef: '#1234',
    };
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        verdict: 'fail',
        overallScore: 60,
        tierResults: {
          structural: { passed: true, findings: [] },
          functional: {
            passed: false,
            findings: [errFinding],
          },
          regression: { passed: true, findings: [] },
        },
        findings: [errFinding],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const errors = result.data.findings.filter((f) => f.severity === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].description).toContain('outside dev targeted set');
    }
  });
});

// ─── CriteriaResultSchema ─────────────────────────────────────────────────────

describe('CriteriaResultSchema', () => {
  it('accepts a passing criteria result', () => {
    const result = CriteriaResultSchema.safeParse({
      criterionId: 'AC-1',
      checkId: 'AC-1-check-1',
      ac: 'Loader returns two projects',
      command: 'pnpm test ',
      expectedExitCodes: [0],
      exitCode: 0,
      actual: '2 tests passed, 0 failed',
      outputExpectation: { mode: 'contains', value: '2 tests passed' },
      passed: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failing criteria result', () => {
    const result = CriteriaResultSchema.safeParse({
      criterionId: 'AC-2',
      checkId: 'AC-2-check-1',
      ac: 'Loader deduplicates slugs',
      command: 'pnpm test  core/projects',
      expectedExitCodes: [0],
      exitCode: 1,
      actual: 'Test failed: expected DuplicateSlugError',
      outputExpectation: { mode: 'exact', value: 'DuplicateSlugError thrown' },
      passed: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing ac field', () => {
    const result = CriteriaResultSchema.safeParse({
      command: 'pnpm test',
      expected: 'pass',
      actual: 'fail',
      tolerance: 'exact',
      passed: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing passed field', () => {
    const result = CriteriaResultSchema.safeParse({
      ac: 'Something',
      command: 'pnpm test',
      expected: 'pass',
      actual: 'pass',
      tolerance: 'exact',
    });
    expect(result.success).toBe(false);
  });
});

// ─── QaOutputSchema with criteriaResults ─────────────────────────────────────

describe('QaOutputSchema with criteriaResults', () => {
  it('accepts a valid output with criteriaResults', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        criteriaResults: [
          {
            criterionId: 'AC-1',
            checkId: 'AC-1-check-1',
            ac: 'AC one',
            command: 'pnpm test',
            expectedExitCodes: [0],
            exitCode: 0,
            actual: 'pass',
            outputExpectation: { mode: 'exact', value: 'pass' },
            passed: true,
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a valid output without criteriaResults (optional)', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.criteriaResults).toBeUndefined();
    }
  });

  it('accepts an empty criteriaResults array', () => {
    const result = QaOutputSchema.safeParse(makeValidOutput({ criteriaResults: [] }));
    expect(result.success).toBe(true);
  });

  it('rejects criteriaResults entry with missing passed field', () => {
    const result = QaOutputSchema.safeParse(
      makeValidOutput({
        criteriaResults: [
          {
            criterionId: 'AC',
            checkId: 'AC-check-1',
            ac: 'AC',
            command: 'cmd',
            expectedExitCodes: [0],
            exitCode: 0,
            actual: 'act',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});
