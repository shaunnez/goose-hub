import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config, { QaContextSchema } from './config.js';
import {
  CriteriaResultSchema,
  FindingSchema,
  QaOutputSchema,
  QualityScoresSchema,
  TierResultSchema,
  computeOverallScore,
} from './schema.js';

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
    decisionSummaries: [{ step: 'structural-check', summary: 'All lint and type-check passed' }],
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
            findings: [{ tier: 'functional', severity: 'error', description: 'Test failed' }],
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

// ─── FindingSchema ───────────────────────────────────────────────────────────

describe('FindingSchema', () => {
  it('accepts a minimal structural finding', () => {
    const result = FindingSchema.safeParse({
      tier: 'structural',
      severity: 'error',
      description: 'Biome lint error: missing semicolon',
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
      findings: [{ tier: 'structural', severity: 'error', description: 'lint error' }],
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

  it('has shell toolBundle for running commands', () => {
    expect(config.toolBundles).toContain('shell');
  });

  it('contextAllowlist contains workItem', () => {
    expect(config.contextAllowlist).toContain('workItem');
  });

  it('contextAllowlist contains prDiff', () => {
    expect(config.contextAllowlist).toContain('prDiff');
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
      projectCommands: { testCommand: 'pnpm test --run', lintCommand: 'pnpm biome check .' },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts optional sliceTests', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff output here',
      projectCommands: { testCommand: 'pnpm test --run' },
      sliceTests: ['skills/qa/slice.test.ts'],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem', () => {
    const invalid = QaContextSchema.safeParse({
      prDiff: 'diff output',
      projectCommands: { testCommand: 'pnpm test --run' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing prDiff', () => {
    const invalid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      projectCommands: { testCommand: 'pnpm test --run' },
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
      projectCommands: { testCommand: 'pnpm test --run' },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema accepts optional verifyCommands array', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test --run' },
      verifyCommands: [
        {
          ac: 'Loader returns two projects',
          command: 'pnpm test --run',
          expected: '2 tests passed',
          tolerance: 'contains',
        },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts empty verifyCommands array', () => {
    const valid = QaContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff',
      projectCommands: { testCommand: 'pnpm test --run' },
      verifyCommands: [],
    });
    expect(valid.success).toBe(true);
  });

  it('contextAllowlist contains verifyCommands', () => {
    expect(config.contextAllowlist).toContain('verifyCommands');
  });
});

// ─── CriteriaResultSchema ─────────────────────────────────────────────────────

describe('CriteriaResultSchema', () => {
  it('accepts a passing criteria result', () => {
    const result = CriteriaResultSchema.safeParse({
      ac: 'Loader returns two projects',
      command: 'pnpm test --run',
      expected: '2 tests passed',
      actual: '2 tests passed, 0 failed',
      tolerance: 'contains',
      passed: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failing criteria result', () => {
    const result = CriteriaResultSchema.safeParse({
      ac: 'Loader deduplicates slugs',
      command: 'pnpm test --run core/projects',
      expected: 'DuplicateSlugError thrown',
      actual: 'Test failed: expected DuplicateSlugError',
      tolerance: 'exact',
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
            ac: 'AC one',
            command: 'pnpm test',
            expected: 'pass',
            actual: 'pass',
            tolerance: 'exact',
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
          { ac: 'AC', command: 'cmd', expected: 'exp', actual: 'act', tolerance: 'exact' },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});
