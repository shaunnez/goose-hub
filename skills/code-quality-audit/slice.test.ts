import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import {
  CodeQualityAuditContextSchema,
  CodeQualityAuditOutputSchema,
  scoreToRating,
} from './schema.js';
import config from './skill.config.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_EVIDENCE = [{ file: 'src/index.ts', line: 1, note: 'violating file' }];

function buildScorecard(scores: [number, number][]) {
  const names = [
    'Open/Closed Compliance',
    'Concept Count',
    'Time-to-New-Capability',
    'Complecting Score',
    'LOC Discipline',
    'Coupling / Fan-Out',
    "Gall's Law Compliance",
    'Cyclomatic Complexity',
  ];
  const maxes = [20, 15, 15, 15, 10, 10, 10, 5];
  return scores.map(([score], i) => ({
    category: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    name: names[i],
    score,
    max: maxes[i],
    evidence: MINIMAL_EVIDENCE,
  }));
}

/** A scorecard where total = 82, rating should be 'Good'. */
const GOOD_SCORECARD = buildScorecard([[15], [12], [12], [12], [8], [8], [10], [5]]);

/** A scorecard where total = 42, rating should be 'Concerning'. */
const CONCERNING_SCORECARD = buildScorecard([[5], [4], [4], [4], [8], [5], [7], [5]]);

/**
 * Golden fixture: known coupling violations.
 * Cat 6 score = 3/10 (critical fan-out: 3 files above critical threshold).
 * P0 recommendation cites violating file:line.
 */
const COUPLING_VIOLATION_OUTPUT = {
  scorecard: buildScorecard([[15], [12], [12], [12], [8], [3], [7], [5]]),
  rating: 'NeedsWork' as const,
  strengths: ['Good test coverage', 'Consistent naming conventions'],
  recommendations: [
    {
      priority: 'P0' as const,
      principle: 'McIlroy: small is beautiful',
      file: 'src/orchestrator.ts',
      line: 1,
      fix: 'Extract 4 unrelated imports into a dedicated adapter module',
      effort: 'Medium' as const,
      impactPoints: 7,
    },
  ],
  mcIlroyQuestion: 'Components cannot be independently piped — orchestrator couples 3 subsystems.',
  projectedScoreAfterTop3: 77,
  decisionSummaries: [
    {
      kind: 'SELF_SCORE' as const,
      summary: 'Cat 6 scored 3/10 — orchestrator.ts has 12 imports, 3 above critical threshold',
      evidence: 'src/orchestrator.ts:1',
    },
  ],
};

// ─── scoreToRating ─────────────────────────────────────────────────────────────

describe('scoreToRating', () => {
  it('returns Exemplary for >= 90', () => {
    expect(scoreToRating(90)).toBe('Exemplary');
    expect(scoreToRating(100)).toBe('Exemplary');
  });

  it('returns Good for 75-89', () => {
    expect(scoreToRating(75)).toBe('Good');
    expect(scoreToRating(89)).toBe('Good');
  });

  it('returns NeedsWork for 55-74', () => {
    expect(scoreToRating(55)).toBe('NeedsWork');
    expect(scoreToRating(74)).toBe('NeedsWork');
  });

  it('returns Concerning for 35-54', () => {
    expect(scoreToRating(35)).toBe('Concerning');
    expect(scoreToRating(54)).toBe('Concerning');
  });

  it('returns Redesign for < 35', () => {
    expect(scoreToRating(0)).toBe('Redesign');
    expect(scoreToRating(34)).toBe('Redesign');
  });
});

// ─── Output schema validation ──────────────────────────────────────────────────

describe('CodeQualityAuditOutputSchema', () => {
  it('accepts valid Good-rated output', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD,
      rating: 'Good',
      strengths: ['Clean separation of concerns'],
      recommendations: [
        {
          priority: 'P1',
          principle: 'SOLID-O',
          file: 'src/router.ts',
          line: 42,
          fix: 'Extract type dispatch into a registry',
          effort: 'Medium',
          impactPoints: 5,
        },
      ],
      mcIlroyQuestion: 'Yes — most components expose clean interfaces.',
      projectedScoreAfterTop3: 88,
      decisionSummaries: [
        { kind: 'SELF_SCORE', summary: 'Cat 1 scored 15/20 — 1 existing file modified' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the golden coupling-violation fixture', () => {
    const result = CodeQualityAuditOutputSchema.safeParse(COUPLING_VIOLATION_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('rejects when scorecard has fewer than 8 entries', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD.slice(0, 7),
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 82,
      decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty evidence array on a scorecard entry', () => {
    const badScorecard = GOOD_SCORECARD.map((e, i) => (i === 0 ? { ...e, evidence: [] } : e));
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: badScorecard,
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 82,
      decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects mismatched rating', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD,
      rating: 'Exemplary',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 82,
      decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects projectedScoreAfterTop3 less than total', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD,
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 70,
      decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects score exceeding max in a category', () => {
    const badScorecard = GOOD_SCORECARD.map((e, i) => (i === 0 ? { ...e, score: 25, max: 20 } : e));
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: badScorecard,
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 90,
      decisionSummaries: [{ kind: 'SELF_SCORE', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decisionSummaries', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD,
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 82,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: GOOD_SCORECARD,
      rating: 'Good',
      strengths: [],
      recommendations: [],
      mcIlroyQuestion: 'Yes.',
      projectedScoreAfterTop3: 82,
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts Concerning-rated output', () => {
    const result = CodeQualityAuditOutputSchema.safeParse({
      scorecard: CONCERNING_SCORECARD,
      rating: 'Concerning',
      strengths: [],
      recommendations: [
        {
          priority: 'P0',
          principle: 'SOLID-O',
          file: 'src/core.ts',
          line: 10,
          fix: 'Introduce an extension registry',
          effort: 'High',
          impactPoints: 15,
        },
      ],
      mcIlroyQuestion: 'No — core.ts is a monolith.',
      projectedScoreAfterTop3: 57,
      decisionSummaries: [
        { kind: 'SELF_SCORE', summary: 'Cat 1 scored 5/20 — core platform must change' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('zod toJSONSchema roundtrip produces valid schema', () => {
    const jsonSchema = toJSONSchema(CodeQualityAuditOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

// ─── Golden fixture test: coupling violation assertions ─────────────────────────

describe('golden fixture — coupling violation', () => {
  it('Cat 6 score is <= 5 when coupling violations are present', () => {
    const result = CodeQualityAuditOutputSchema.safeParse(COUPLING_VIOLATION_OUTPUT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const cat6 = result.data.scorecard.find((e) => e.category === 6);
    expect(cat6).toBeDefined();
    expect(cat6?.score).toBeLessThanOrEqual(5);
  });

  it('at least one P0 recommendation references the violating file:line', () => {
    const result = CodeQualityAuditOutputSchema.safeParse(COUPLING_VIOLATION_OUTPUT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const p0s = result.data.recommendations.filter((r) => r.priority === 'P0');
    expect(p0s.length).toBeGreaterThanOrEqual(1);
    expect(p0s[0].file).toBe('src/orchestrator.ts');
    expect(p0s[0].line).toBe(1);
  });
});

// ─── Context schema validation ─────────────────────────────────────────────────

describe('CodeQualityAuditContextSchema', () => {
  it('accepts empty model-visible context', () => {
    const result = CodeQualityAuditContextSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts context with metricsJson', () => {
    const result = CodeQualityAuditContextSchema.safeParse({
      metricsJson: {
        locDiscipline: { score: 8, pctUnder200: 92 },
        coupling: { score: 7, avgImports: 3.2, maxImports: 8, maxFile: 'src/orchestrator.ts' },
        cyclomaticComplexity: { score: 4, pctUnder10: 91 },
        fileCount: 45,
        scannedAt: '2026-05-08T00:00:00Z',
      },
    });
    expect(result.success).toBe(true);
  });

  it('does not require worktreePath', () => {
    expect(CodeQualityAuditContextSchema.safeParse({}).success).toBe(true);
  });
});

// ─── Skill config tests ───────────────────────────────────────────────────────

describe('code-quality-audit skill config', () => {
  it('has role auditor', () => {
    expect(config.role).toBe('auditor');
  });

  it('is pinned to opus model', () => {
    expect(config.modelPin).toBe('opus');
  });

  it('uses the read bundle (factory-tools read + git/diff covers Cat 7)', () => {
    expect(config.toolBundles).toContain('read');
    expect(config.toolBundles).not.toContain('shell');
  });

  it('does not require fresh context (not a holdout role)', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextAllowlist excludes worktreePath and includes metricsJson', () => {
    expect(config.contextAllowlist).not.toContain('worktreePath');
    expect(config.contextAllowlist).toContain('metricsJson');
  });
});
