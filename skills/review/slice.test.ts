import { describe, expect, it } from 'vitest';
import config, { ReviewContextSchema } from './config.js';
import { CriterionCheckSchema, ReviewFindingSchema, ReviewOutputSchema } from './schema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApprovedOutput(overrides = {}) {
  return {
    verdict: 'approved',
    confidence: 0.9,
    criteriaChecks: [{ criterion: 'Schema exports are valid', status: 'met' }],
    findings: [],
    decisionSummaries: [{ step: 'issue-read', summary: 'Issue #42 parsed: 1 criterion found' }],
    ...overrides,
  };
}

function makeNeedsFixOutput(overrides = {}) {
  return {
    verdict: 'needs-fix',
    confidence: 0.65,
    criteriaChecks: [
      { criterion: 'All tests pass', status: 'unmet', notes: 'slice.test.ts is missing' },
    ],
    findings: [
      { severity: 'blocker', description: 'Missing slice.test.ts required by FACTORY_RULES' },
    ],
    decisionSummaries: [
      { step: 'criteria-check', summary: 'Criterion unmet: slice.test.ts absent' },
    ],
    ...overrides,
  };
}

function makeNeedsHumanOutput(overrides = {}) {
  return {
    verdict: 'needs-human',
    confidence: 0.3,
    criteriaChecks: [{ criterion: 'Architecture is sound', status: 'unclear' }],
    findings: [
      {
        severity: 'major',
        description: 'Ambiguous architectural decision requires human judgement',
      },
    ],
    decisionSummaries: [
      { step: 'verdict', summary: 'Escalating: confidence below 0.5 on unclear criterion' },
    ],
    escalationReason:
      'Confidence below 0.5: cannot determine if architectural constraint is satisfied without human input',
    ...overrides,
  };
}

// ─── ReviewOutputSchema — approved ───────────────────────────────────────────

describe('ReviewOutputSchema — approved verdict', () => {
  it('accepts a valid approved result', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput());
    expect(result.success).toBe(true);
  });

  it('accepted approved result carries all required fields', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('approved');
      expect(result.data.confidence).toBe(0.9);
      expect(result.data.criteriaChecks).toHaveLength(1);
      expect(result.data.findings).toHaveLength(0);
      expect(result.data.decisionSummaries).toHaveLength(1);
    }
  });

  it('approved result does NOT require escalationReason', () => {
    const output = makeApprovedOutput();
    expect('escalationReason' in output).toBe(false);
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });
});

// ─── ReviewOutputSchema — needs-fix ──────────────────────────────────────────

describe('ReviewOutputSchema — needs-fix verdict', () => {
  it('accepts a valid needs-fix result', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsFixOutput());
    expect(result.success).toBe(true);
  });

  it('needs-fix result carries criteriaChecks with unmet status', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsFixOutput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('needs-fix');
      expect(result.data.criteriaChecks[0].status).toBe('unmet');
    }
  });

  it('needs-fix result does NOT require escalationReason', () => {
    const output = makeNeedsFixOutput();
    expect('escalationReason' in output).toBe(false);
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });
});

// ─── ReviewOutputSchema — needs-human ────────────────────────────────────────

describe('ReviewOutputSchema — needs-human verdict', () => {
  it('accepts a valid needs-human result WITH escalationReason', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput());
    expect(result.success).toBe(true);
  });

  it('needs-human without escalationReason is REJECTED', () => {
    const { escalationReason: _e, ...withoutEscalation } = makeNeedsHumanOutput();
    const result = ReviewOutputSchema.safeParse(withoutEscalation);
    expect(result.success).toBe(false);
  });

  it('needs-human with empty escalationReason is REJECTED', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput({ escalationReason: '' }));
    expect(result.success).toBe(false);
  });

  it('needs-human with whitespace-only escalationReason passes min(1) check', () => {
    // min(1) means at least 1 character; a space technically passes
    // This tests the literal schema constraint, not business logic
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput({ escalationReason: ' ' }));
    expect(result.success).toBe(true);
  });
});

// ─── ReviewOutputSchema — verdict validation ──────────────────────────────────

describe('ReviewOutputSchema — verdict validation', () => {
  it('rejects an unknown verdict', () => {
    const result = ReviewOutputSchema.safeParse({
      ...makeApprovedOutput(),
      verdict: 'rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing verdict', () => {
    const { verdict: _v, ...rest } = makeApprovedOutput();
    const result = ReviewOutputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── CriterionCheckSchema ─────────────────────────────────────────────────────

describe('CriterionCheckSchema', () => {
  it('accepts status: met', () => {
    const result = CriterionCheckSchema.safeParse({
      criterion: 'All tests pass',
      status: 'met',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: unmet', () => {
    const result = CriterionCheckSchema.safeParse({
      criterion: 'README.md is present',
      status: 'unmet',
      notes: 'File not found in diff',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: unclear', () => {
    const result = CriterionCheckSchema.safeParse({
      criterion: 'No breaking changes',
      status: 'unclear',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = CriterionCheckSchema.safeParse({
      criterion: 'Something',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing criterion', () => {
    const result = CriterionCheckSchema.safeParse({ status: 'met' });
    expect(result.success).toBe(false);
  });

  it('rejects missing status', () => {
    const result = CriterionCheckSchema.safeParse({ criterion: 'Something' });
    expect(result.success).toBe(false);
  });
});

// ─── ReviewFindingSchema ──────────────────────────────────────────────────────

describe('ReviewFindingSchema', () => {
  it('accepts a blocker finding', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'blocker',
      description: 'Acceptance criterion unmet: slice.test.ts missing',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a major finding with optional fields', () => {
    const result = ReviewFindingSchema.safeParse({
      criterion: 'No inline prompts in code',
      severity: 'major',
      description: 'Prompt found inline in src/agent.ts',
      suggestion: 'Move to skills/myskill/skill.md',
      file: 'src/agent.ts',
      line: 37,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a minor finding', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'minor',
      description: 'JSDoc comment could be more descriptive',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'critical',
      description: 'Something very bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects severity: error (QA enum, not Review enum)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'error',
      description: 'A QA-style severity that is invalid for Review',
    });
    expect(result.success).toBe(false);
  });

  it('rejects severity: warning (QA enum, not Review enum)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'warning',
      description: 'A QA-style severity that is invalid for Review',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = ReviewFindingSchema.safeParse({ severity: 'blocker' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer line number', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'minor',
      description: 'Indentation issue',
      line: 3.5,
    });
    expect(result.success).toBe(false);
  });
});

// ─── confidence range validation ──────────────────────────────────────────────

describe('confidence range validation', () => {
  it('accepts confidence at 0.0 (minimum)', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput({ confidence: 0.0 }));
    expect(result.success).toBe(true);
  });

  it('accepts confidence at 1.0 (maximum)', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput({ confidence: 1.0 }));
    expect(result.success).toBe(true);
  });

  it('rejects confidence above 1.0', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput({ confidence: 1.1 }));
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0.0', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput({ confidence: -0.1 }));
    expect(result.success).toBe(false);
  });
});

// ─── Review skill config ──────────────────────────────────────────────────────

describe('review skill config', () => {
  it('has freshContext: true (holdout requirement)', () => {
    expect(config.freshContext).toBe(true);
  });

  it('has role: reviewer', () => {
    expect(config.role).toBe('reviewer');
  });

  it('contextAllowlist contains workItem', () => {
    expect(config.contextAllowlist).toContain('workItem');
  });

  it('contextAllowlist contains prDiff', () => {
    expect(config.contextAllowlist).toContain('prDiff');
  });

  it('contextAllowlist contains qaVerdict', () => {
    expect(config.contextAllowlist).toContain('qaVerdict');
  });

  it('contextAllowlist does NOT contain devDecisionSummaries', () => {
    expect(config.contextAllowlist).not.toContain('devDecisionSummaries');
  });

  it('contextAllowlist does NOT contain investigationFindings', () => {
    expect(config.contextAllowlist).not.toContain('investigationFindings');
  });

  it('contextSchema validates required workItem and prDiff', () => {
    const valid = ReviewContextSchema.safeParse({
      workItem: {
        title: 'Add review skill',
        body: '- [ ] schema defined\n- [ ] tests pass',
        number: 240,
      },
      prDiff: 'diff --git a/skills/review/schema.ts b/skills/review/schema.ts\n...',
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts optional qaVerdict', () => {
    const valid = ReviewContextSchema.safeParse({
      workItem: { title: 'Add review skill', body: '- [ ] schema defined', number: 240 },
      prDiff: 'diff output here',
      qaVerdict: { verdict: 'pass', overallScore: 82 },
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing workItem', () => {
    const invalid = ReviewContextSchema.safeParse({
      prDiff: 'diff output',
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects missing prDiff', () => {
    const invalid = ReviewContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
    });
    expect(invalid.success).toBe(false);
  });

  it('contextSchema rejects invalid qaVerdict verdict value', () => {
    const invalid = ReviewContextSchema.safeParse({
      workItem: { title: 'title', body: 'body', number: 1 },
      prDiff: 'diff output',
      qaVerdict: { verdict: 'approved', overallScore: 82 },
    });
    expect(invalid.success).toBe(false);
  });
});
