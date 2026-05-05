import { describe, expect, it } from 'vitest';
import config from './config.js';
import { ResolveConflictContextSchema, ResolveConflictSchema } from './schema.js';

describe('ResolveConflictSchema', () => {
  it('accepts valid output with all resolved', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: ['src/foo.ts', 'src/bar.ts'],
      unresolvable: [],
      confidence: 'high',
      decisionSummaries: [{ kind: 'GREEN', summary: 'Merged both sides of foo.ts cleanly' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid output with unresolvable files', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: ['src/foo.ts'],
      unresolvable: ['src/complex.ts'],
      confidence: 'low',
      decisionSummaries: [{ kind: 'GREEN', summary: 'complex.ts has semantic conflicts' }],
    });
    expect(result.success).toBe(true);
  });

  it('requires at least one decisionSummary', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: [],
      unresolvable: [],
      confidence: 'medium',
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid confidence', () => {
    const result = ResolveConflictSchema.safeParse({
      resolved: [],
      unresolvable: [],
      confidence: 'very-high',
      decisionSummaries: [{ kind: 'PLAN', summary: 'y' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('ResolveConflictContextSchema', () => {
  it('accepts a complete context', () => {
    const result = ResolveConflictContextSchema.safeParse({
      worktreePath: '/abs/path/to/worktree',
      conflictedFiles: ['src/foo.ts'],
      baseBranch: 'main',
      prNumber: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer prNumber', () => {
    const result = ResolveConflictContextSchema.safeParse({
      worktreePath: '/p',
      conflictedFiles: [],
      baseBranch: 'main',
      prNumber: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('config', () => {
  it('uses dev-tools bundle', () => {
    expect(config.toolBundles).toEqual(['dev-tools']);
  });
  it('pins model to sonnet', () => {
    expect(config.modelPin).toBe('sonnet');
  });
  it('lists exactly the four context keys', () => {
    expect(config.contextAllowlist).toStrictEqual([
      'worktreePath',
      'conflictedFiles',
      'baseBranch',
      'prNumber',
    ]);
  });
});
