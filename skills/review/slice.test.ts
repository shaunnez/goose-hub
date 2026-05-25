import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CriterionCheckSchema, ReviewFindingSchema, ReviewOutputSchema } from './schema.js';
import config, { ReviewContextSchema } from './skill.config.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApprovedOutput(overrides = {}) {
  return {
    verdict: 'approved',
    confidence: 0.9,
    criteriaChecks: [{ criterion: 'Schema exports are valid', status: 'met' }],
    findings: [],
    decisionSummaries: [{ kind: 'READ', summary: 'Issue #42 parsed: 1 criterion found' }],
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
      {
        severity: 'blocker',
        description: 'Missing slice.test.ts required by FACTORY_RULES',
        // #468 — every blocker carries a disposition. Here it's `follow-up`
        // because slice.test.ts gap is being filed as a follow-up.
        disposition: 'follow-up',
        dispositionRef: '#999',
      },
    ],
    decisionSummaries: [
      { kind: 'CRITERIA_CHECK', summary: 'Criterion unmet: slice.test.ts absent' },
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
      { kind: 'VERDICT', summary: 'Escalating: confidence below 0.5 on unclear criterion' },
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

  it('approved result accepts null escalationReason from Codex-shaped output', () => {
    const result = ReviewOutputSchema.safeParse(makeApprovedOutput({ escalationReason: null }));
    expect(result.success).toBe(true);
  });

  it('accepts decision summaries with valid kinds (#466)', () => {
    const result = ReviewOutputSchema.safeParse(
      makeApprovedOutput({
        decisionSummaries: [
          { kind: 'READ', summary: 'Read 6 criteria' },
          { kind: 'DIFF_READ', summary: '5 files changed' },
          { kind: 'CRITERIA_CHECK', summary: '6 met, 0 unmet' },
          { kind: 'VERDICT', summary: 'approved' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects decision summaries with an invalid kind (#466)', () => {
    const result = ReviewOutputSchema.safeParse(
      makeApprovedOutput({
        decisionSummaries: [{ kind: 'random-string', summary: 'x' }],
      }),
    );
    expect(result.success).toBe(false);
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

  it('needs-fix result accepts null escalationReason from Codex-shaped output', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsFixOutput({ escalationReason: null }));
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

  it('needs-human with null escalationReason is REJECTED', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput({ escalationReason: null }));
    expect(result.success).toBe(false);
  });

  it('needs-human with whitespace-only escalationReason is REJECTED', () => {
    const result = ReviewOutputSchema.safeParse(makeNeedsHumanOutput({ escalationReason: ' ' }));
    expect(result.success).toBe(false);
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
  it('accepts a blocker finding with disposition (fix-or-register, #468)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'blocker',
      description: 'Acceptance criterion unmet: slice.test.ts missing',
      disposition: 'follow-up',
      dispositionRef: '#345',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a major finding with optional fields', () => {
    const result = ReviewFindingSchema.safeParse({
      criterion: 'No inline prompts in code',
      severity: 'major',
      description: 'Prompt found inline in src/agent.ts',
      suggestion: 'Move to skills/myskill/prompt.md',
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
    const result = ReviewFindingSchema.safeParse({
      severity: 'blocker',
      disposition: 'follow-up',
      dispositionRef: '#1',
    });
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

  // ── #468 — fix-or-register ────────────────────────────────────────────────

  it("accepts a blocker with disposition 'fixed' and a commit SHA (#468)", () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'blocker',
        description: 'Inline prompt — moved to prompt.md',
        disposition: 'fixed',
        dispositionRef: 'd34db33f',
      }).success,
    ).toBe(true);
  });

  it("accepts a blocker with disposition 'out-of-scope' and a rationale (#468)", () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'blocker',
        description: 'Workspace lock-file refactor needed',
        disposition: 'out-of-scope',
        dispositionRef: 'pre-existing infra concern; tracked in M11 milestone planning',
      }).success,
    ).toBe(true);
  });

  it('rejects a blocker without disposition (#468)', () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'blocker',
        description: 'Missing slice.test.ts',
      }).success,
    ).toBe(false);
  });

  it('rejects a blocker with disposition but empty dispositionRef (#468)', () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'blocker',
        description: 'Missing README',
        disposition: 'follow-up',
        dispositionRef: '',
      }).success,
    ).toBe(false);
  });

  it('major-severity findings do not require disposition (#468)', () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'major',
        description: 'Naming inconsistency',
      }).success,
    ).toBe(true);
  });

  it('minor-severity findings may carry an optional disposition (#468)', () => {
    expect(
      ReviewFindingSchema.safeParse({
        severity: 'minor',
        description: 'Helper could be simpler',
        disposition: 'out-of-scope',
        dispositionRef: 'cleanup tracked separately',
      }).success,
    ).toBe(true);
  });

  // ── #697 — priority field on review findings ────────────────────────────

  it('accepts an explicit priority on a review finding (#697)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'blocker',
      description: 'missing required file',
      disposition: 'follow-up',
      dispositionRef: '#123',
      priority: 'P0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('P0');
    }
  });

  it('treats priority as optional (#697)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'minor',
      description: 'naming nit',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid priority literal (#697)', () => {
    const result = ReviewFindingSchema.safeParse({
      severity: 'minor',
      description: 'naming nit',
      priority: 'low',
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

// ─── prompt.md — criteriaChecks output requirement ───────────────────────────

describe('prompt.md — criteriaChecks population requirement', () => {
  const promptMd = readFileSync(join(import.meta.dirname, 'prompt.md'), 'utf-8');

  it('output format section explicitly requires one entry per criterion', () => {
    // Must contain language stating criteriaChecks needs one entry per criterion
    expect(promptMd).toMatch(/criteriaChecks.*one entry per/s);
  });

  it('warns that empty criteriaChecks array is never valid when criteria exist', () => {
    // Must contain a warning that criteriaChecks: [] is never valid
    expect(promptMd).toMatch(
      /criteriaChecks.*\[\].*never valid|criteriaChecks: \[\].*never valid/s,
    );
  });
});

// ─── prompt.unconstrained.md — blocker disposition contract ──────────────────

describe('prompt.unconstrained.md — blocker disposition contract', () => {
  const promptMd = readFileSync(join(import.meta.dirname, 'prompt.unconstrained.md'), 'utf-8');

  it('requires blocker findings to include dispositionRef', () => {
    expect(promptMd).toMatch(/blocker[\s\S]+dispositionRef/);
    expect(promptMd).toMatch(/without `dispositionRef` fails schema validation/);
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

  it('contextAllowlist contains prDiffWithContext', () => {
    expect(config.contextAllowlist).toContain('prDiffWithContext');
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
      prDiffWithContext: {
        changedFiles: ['skills/review/schema.ts'],
        hunkCount: 1,
        hunks: [
          {
            file: 'skills/review/schema.ts',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
          },
        ],
        diffCharCount: 64,
      },
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
