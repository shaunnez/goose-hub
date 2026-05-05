import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import config, { ImplementContextSchema } from './config.js';
import { ImplementSchema } from './schema.js';

describe('implement output schema', () => {
  const baseValid = {
    plan: 'Add helper at core/foo/bar.ts; tests in core/foo/bar.test.ts.',
    filesWritten: [
      { path: 'core/foo/bar.ts', reason: 'new helper' },
      { path: 'core/foo/bar.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
    testsRun: {
      command: 'pnpm test --run',
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
        command: 'pnpm vitest --run',
        paths: ['core/foo/bar.test.ts'],
      },
      evidenceSpecPath: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testsRun.command).toBe('pnpm vitest --run');
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
        testsRun: { command: 'pnpm test --run', paths: [] },
        evidenceSpecPath: null,
      }).success,
    ).toBe(true);
  });

  it('rejects empty testsRun.paths when testsWritten is non-empty (#467 — must record what dev ran)', () => {
    expect(
      ImplementSchema.safeParse({
        ...baseValid,
        testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
        testsRun: { command: 'pnpm test --run', paths: [] },
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

  it('contextAllowlist includes worktreePath, stack.testCommand, advisorFeedback', () => {
    expect(config.contextAllowlist).toContain('worktreePath');
    expect(config.contextAllowlist).toContain('stack.testCommand');
    expect(config.contextAllowlist).toContain('advisorFeedback');
    expect(config.contextAllowlist).toContain('revisionPass');
  });
});

describe('implement context schema', () => {
  const baseContext = {
    workItem: { title: 't', body: 'b', number: 1, priority: 'medium' as const },
    worktreePath: '/abs/path',
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

  it('rejects missing worktreePath', () => {
    const { worktreePath: _omit, ...rest } = baseContext;
    expect(ImplementContextSchema.safeParse(rest).success).toBe(false);
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
