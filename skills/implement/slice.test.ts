import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { computeOverallScore } from '../qa/schema.js';
import { ImplementSchema } from './schema.js';
import { anyZeroCategory } from './schema.js';
import config, { ImplementContextSchema } from './skill.config.js';

describe('implement output schema', () => {
  const baseValid = {
    plan: 'Add helper at core/foo/bar.ts; tests in core/foo/bar.test.ts.',
    filesWritten: [
      { path: 'core/foo/bar.ts', reason: 'new helper' },
      { path: 'core/foo/bar.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
    testsRun: {
      command: 'pnpm test ',
      paths: ['core/foo/bar.test.ts'],
    },
    prUrl: 'https://github.com/owner/repo/issues/123',
    evidenceSpecPath: 'apps/web/e2e/issue-123.spec.ts',
    confidence: 'high' as const,
    decisionSummaries: [
      { kind: 'PLAN', summary: 'Add helper' },
      { kind: 'GREEN', summary: 'All tests pass' },
    ],
  };

  it('accepts a fully-populated valid output', () => {
    expect(ImplementSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts evidenceSpecPath as null (no spec authored)', () => {
    expect(ImplementSchema.safeParse({ ...baseValid, evidenceSpecPath: null }).success).toBe(true);
  });

  it('accepts web changes without evidenceSpecPath when an evidence blocker is recorded', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        filesWritten: [{ path: 'apps/web/src/components/Foo.tsx', reason: 'copy fix' }],
        evidenceSpecPath: null,
        decisionSummaries: [
          { kind: 'PLAN', summary: 'Update the investigated web copy surface' },
          {
            kind: 'UNCERTAINTY',
            summary: 'Playwright evidence spec generation blocked because no e2e harness exists',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects web changes without evidenceSpecPath when no evidence blocker is recorded', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        filesWritten: [{ path: 'apps/web/src/components/Foo.tsx', reason: 'copy fix' }],
        evidenceSpecPath: null,
      }).success,
    ).toBe(false);
  });

  it('accepts empty testsWritten (chore PRs may not add tests)', () => {
    expect(ImplementSchema.safeParse({ ...baseValid, testsWritten: [] }).success).toBe(true);
  });

  it('rejects empty plan', () => {
    expect(ImplementSchema.safeParse({ ...baseValid, plan: '' }).success).toBe(false);
  });

  it('rejects non-URL prUrl', () => {
    expect(ImplementSchema.safeParse({ ...baseValid, prUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects empty decisionSummaries (FACTORY_RULES rule 6)', () => {
    expect(ImplementSchema.safeParse({ ...baseValid, decisionSummaries: [] }).success).toBe(false);
  });

  it('accepts a known-good output with valid decision-kind values (#466)', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        decisionSummaries: [
          { kind: 'PLAN', summary: 'Add helper at core/foo/bar.ts' },
          { kind: 'RED', summary: 'Wrote 3 failing tests' },
          { kind: 'GREEN', summary: 'All tests pass' },
          { kind: 'LINT', summary: 'biome clean' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a decisionSummaries entry with an invalid kind (#466)', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        decisionSummaries: [{ kind: 'plan', summary: 'lowercase rejected' }],
      }).success,
    ).toBe(false);
  });

  it('records testsRun with command and paths matching what dev actually ran (#467)', () => {
    const result = ImplementSchema.safeParse({
      ...baseValid,
      filesWritten: [
        { path: 'core/foo/bar.ts', reason: 'new helper' },
        { path: 'core/foo/bar.test.ts', reason: 'tests' },
      ],
      testsRun: {
        command: 'pnpm vitest ',
        paths: ['core/foo/bar.test.ts'],
      },
      evidenceSpecPath: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testsRun.command).toBe('pnpm vitest ');
      expect(result.data.testsRun.paths).toEqual(['core/foo/bar.test.ts']);
    }
  });

  it('rejects output missing testsRun (#467 — required field)', () => {
    const { testsRun: _omit, ...rest } = baseValid;
    expect(ImplementSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts empty testsRun.paths when testsWritten is also empty (chore PR)', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        filesWritten: [{ path: 'docs/x.md', reason: 'docs only' }],
        testsWritten: [],
        testsRun: { command: 'pnpm test ', paths: [] },
        evidenceSpecPath: null,
      }).success,
    ).toBe(true);
  });

  it('rejects empty testsRun.paths when testsWritten is non-empty (#467 — must record what dev ran)', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
        testsRun: { command: 'pnpm test ', paths: [] },
        evidenceSpecPath: null,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown confidence value', () => {
    expect(
      ImplementSchema.safeParse({ ...baseValid, confidence: 'mid' as unknown as 'high' }).success,
    ).toBe(false);
  });

  it('rejects fileWritten missing reason', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        filesWritten: [{ path: 'core/foo/bar.ts' } as unknown as { path: string; reason: string }],
      }).success,
    ).toBe(false);
  });

  it('rejects testsWritten.cases as a float', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        testsWritten: [{ path: 'x.test.ts', cases: 2.5 }],
      }).success,
    ).toBe(false);
  });

  it('rejects negative testsWritten.cases', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        testsWritten: [{ path: 'x.test.ts', cases: -1 }],
      }).success,
    ).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces a valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(ImplementSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
  });

  const validScores = {
    openClosed: 18,
    conceptCount: 12,
    timeToCapability: 13,
    complecting: 14,
    loc: 8,
    coupling: 9,
    gallsLaw: 9,
    cyclomaticComplexity: 4,
  }; // sum = 87

  const baseChore = {
    plan: 'chore',
    filesWritten: [{ path: 'docs/x.md', reason: 'docs' }],
    testsWritten: [],
    testsRun: { command: 'pnpm test ', paths: [] },
    prUrl: 'https://github.com/owner/repo/issues/1',
    evidenceSpecPath: null,
    confidence: 'medium' as const,
    decisionSummaries: [{ kind: 'PLAN', summary: 'docs only' }],
  };

  const baseImpl = {
    ...baseChore,
    filesWritten: [
      { path: 'core/foo/bar.ts', reason: 'impl' },
      { path: 'core/foo/bar.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
    testsRun: { command: 'pnpm test ', paths: ['core/foo/bar.test.ts'] },
    confidence: 'high' as const,
  };

  it('AC schema T1: accepts valid scores with selfScoreBelowThreshold false', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfQualityScore: validScores,
      selfScoreBelowThreshold: false,
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
  });

  it('AC schema T2: accepts without scores (backward compat / chore)', () => {
    expect(ImplementSchema.safeParse(baseChore).success).toBe(true);
  });

  it('AC schema T3: high confidence + below threshold => warns, no hard-fail', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfScoreBelowThreshold: true,
      confidence: 'high',
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selfScoreWarnings.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('AC schema T4: low confidence + threshold passed => warns, no hard-fail', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfScoreBelowThreshold: false,
      confidence: 'low',
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selfScoreWarnings.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('AC schema T5: score tuple inconsistent with flag => hard-fail', () => {
    // validScores sums to 87 (>= 70, no zeros) but flag says below threshold
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfQualityScore: validScores,
      selfScoreBelowThreshold: true,
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(false);
  });

  it('AC schema T6a: anyZeroCategory returns true when a category is zero', () => {
    expect(anyZeroCategory({ ...validScores, openClosed: 0 })).toBe(true);
  });

  it('AC schema T6b: anyZeroCategory returns false when no category is zero', () => {
    expect(anyZeroCategory(validScores)).toBe(false);
  });

  it('AC schema T7a: computeOverallScore sums to 100 for max scores', () => {
    expect(
      computeOverallScore({
        openClosed: 20,
        conceptCount: 15,
        timeToCapability: 15,
        complecting: 15,
        loc: 10,
        coupling: 10,
        gallsLaw: 10,
        cyclomaticComplexity: 5,
      }),
    ).toBe(100);
  });

  it('AC schema T7b: computeOverallScore returns 0 for all-zero scores', () => {
    expect(
      computeOverallScore({
        openClosed: 0,
        conceptCount: 0,
        timeToCapability: 0,
        complecting: 0,
        loc: 0,
        coupling: 0,
        gallsLaw: 0,
        cyclomaticComplexity: 0,
      }),
    ).toBe(0);
  });
});

describe('implement skill config', () => {
  it('has role developer (NOT a holdout)', () => {
    expect(config.role).toBe('developer');
  });

  it('uses dev-tools bundle (sandboxed read/write/bash/test)', () => {
    expect(config.toolBundles).toContain('dev-tools');
  });

  it('is pinned to sonnet (routine implementation tier)', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context (developer sees prior decision summaries)', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextAllowlist excludes worktreePath and includes implementation context', () => {
    expect(config.contextAllowlist).not.toContain('worktreePath');
    expect(config.contextAllowlist).toContain('stack.testCommand');
    expect(config.contextAllowlist).toContain('relatedSurface');
    expect(config.contextAllowlist).toContain('advisorFeedback');
    expect(config.contextAllowlist).toContain('revisionPass');
  });
});

describe('implement context schema', () => {
  const baseContext = {
    workItem: { title: 't', body: 'b', number: 1, priority: 'medium' as const },
    stack: { testCommand: 'pnpm test' },
  };

  it('accepts minimal valid context', () => {
    expect(ImplementContextSchema.safeParse(baseContext).success).toBe(true);
  });

  it('accepts all optional stack fields', () => {
    expect(
      ImplementContextSchema.safeParse({
        ...baseContext,
        stack: { testCommand: 'pnpm test', lintCommand: 'pnpm lint', typecheckCommand: 'pnpm tc' },
      }).success,
    ).toBe(true);
  });

  it('accepts revisionPass and advisorFeedback', () => {
    expect(
      ImplementContextSchema.safeParse({
        ...baseContext,
        revisionPass: 1,
        advisorFeedback: 'previous notes',
      }).success,
    ).toBe(true);
  });

  it('accepts relatedSurface handoff context', () => {
    expect(
      config.contextSchema.safeParse({
        ...baseContext,
        relatedSurface: {
          keyFiles: [{ path: 'apps/web/src/components/chrome/Sidebar.tsx' }],
          packageRoots: ['apps/web'],
          existingTests: [],
          testCandidates: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
          evidenceSpecPath: 'apps/web/e2e/issue-876.spec.ts',
          checkedAbsent: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
          targetedTestPaths: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
          readFirst: [
            'apps/web/src/components/chrome/Sidebar.tsx',
            'apps/web/src/components/chrome/Sidebar.test.tsx',
          ],
          primaryTestPath: 'apps/web/src/components/chrome/Sidebar.test.tsx',
          testMode: 'create-candidate',
          doNotSearchFor: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
        },
      }).success,
    ).toBe(true);
  });

  it('accepts context without worktreePath', () => {
    expect(ImplementContextSchema.safeParse(baseContext).success).toBe(true);
  });

  it('rejects missing stack.testCommand', () => {
    expect(
      ImplementContextSchema.safeParse({
        ...baseContext,
        stack: {},
      }).success,
    ).toBe(false);
  });

  it('rejects unknown priority value', () => {
    expect(
      ImplementContextSchema.safeParse({
        ...baseContext,
        workItem: { ...baseContext.workItem, priority: 'urgent' as unknown as 'high' },
      }).success,
    ).toBe(false);
  });

  it('rejects revisionPass values other than 0 or 1', () => {
    expect(
      ImplementContextSchema.safeParse({ ...baseContext, revisionPass: 2 as unknown as 0 }).success,
    ).toBe(false);
  });
});

describe('implement prompt', () => {
  const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

  it('treats high-confidence investigation context as the implementation handoff', () => {
    expect(prompt).toContain('Investigation handoff fast path');
    expect(prompt).toMatch(/treat\s+it as the implementation handoff contract/);
    expect(prompt).toContain('Do not continue broad discovery');
  });

  it('guards against no-op bug-fix implementations', () => {
    expect(prompt).toContain('No-op implementation guard');
    expect(prompt).toContain(
      'Existing tests passing before any edit only proves the current baseline',
    );
    expect(prompt).toMatch(/does\s+not satisfy a bug fix/);
    expect(prompt).toContain('modify at least one implementation-surface file');
    expect(prompt).toContain('either an investigated key file');
    expect(prompt).toContain('different implementation file selected by');
    expect(prompt).toContain('valid pivot under the investigation handoff rules');
  });

  it('does not allow test or evidence-only edits to satisfy a bug fix', () => {
    expect(prompt).toContain('Tests and evidence files support the implementation');
    expect(prompt).toMatch(/do not satisfy this\s+guard by themselves for a bug fix/);
  });

  it('requires low-confidence blocker output for no-change conclusions', () => {
    expect(prompt).toContain('stop with `confidence: low`');
    expect(prompt).toContain('`BLOCKER` decision summary');
    expect(prompt).toMatch(/appears already fixed or\s+non-actionable/);
    expect(prompt).toContain('return without pretending to ship');
  });

  it('forbids reporting filesWritten for files that were only read', () => {
    expect(prompt).toContain('The `filesWritten` list must match actual writes');
    expect(prompt).toContain('`mcp__factory-tools__write_file`');
    expect(prompt).toContain('`mcp__factory-tools__edit_file`');
    expect(prompt).toMatch(/do not\s+report files that were only read/);
  });

  it('requires red tests before implementation and green tests only after a write', () => {
    expect(prompt).toContain('fail with the current behavior before');
    expect(prompt).toContain('existing tests encode stale behavior');
    expect(prompt).toMatch(/only after a\s+real write has occurred/);
  });

  it('bounds frontend evidence discovery when e2e support is missing or unclear', () => {
    expect(prompt).toContain('Bounded frontend evidence rule');
    expect(prompt).toContain(
      'Do not inspect old e2e specs, Playwright config, or screenshot conventions',
    );
    expect(prompt).toContain('ship the implementation plus targeted tests');
  });

  it('documents per-field self-quality score ranges', () => {
    expect(prompt).toContain('`openClosed: 0-20`');
    expect(prompt).toContain('`conceptCount`, `timeToCapability`, and `complecting: 0-15`');
    expect(prompt).toContain('`loc`, `coupling`, and `gallsLaw: 0-10`');
    expect(prompt).toContain('`cyclomaticComplexity: 0-5`');
    expect(prompt).toContain('Individual fields are not percentages');
    expect(prompt).toContain('only the aggregate is out of 100');
  });

  it('forbids memory and skill quick passes', () => {
    expect(prompt).toContain('No memory or skill quick pass');
    expect(prompt).toContain('Do not read local assistant memory');
    expect(prompt).toContain('~/.codex');
    expect(prompt).toContain('~/.agents');
    expect(prompt).toContain('~/.claude');
  });

  it('uses record_decision as the primary live timeline signal', () => {
    expect(prompt).toContain('mcp__factory-tools__record_decision');
    expect(prompt).toContain('The tool call is the primary live timeline signal');
    expect(prompt).toContain('do not rely on text markers alone');
  });
});
