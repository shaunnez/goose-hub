import { describe, expect, it } from 'vitest';
import { crossValidate } from './cross-validate.js';
import type { ScoutReport } from './swarm.js';

function rep(name: string, findings: ScoutReport['findings']): ScoutReport {
  return {
    scoutName: name,
    status: 'ok',
    findings,
    decisionSummaries: [],
    runId: `parent:scout:${name}:0`,
  };
}

describe('crossValidate', () => {
  it('detects contradictions when two scouts report incompatible facts at same file:line', () => {
    const result = crossValidate([
      rep('scout-schema', [
        {
          file: 'core/db/schema.ts',
          line: 42,
          fact: 'column "email" is unique',
          confidence: 'high',
        },
      ]),
      rep('scout-code-path', [
        {
          file: 'core/db/schema.ts',
          line: 42,
          fact: 'column "email" is NOT unique',
          confidence: 'high',
        },
      ]),
    ]);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.file).toBe('core/db/schema.ts');
    expect(result.contradictions[0]?.line).toBe(42);
    expect(result.contradictions[0]?.scouts.sort()).toEqual(['scout-code-path', 'scout-schema']);
    expect(result.contradictions[0]?.isBlocking).toBe(true);
    expect(result.contradictions[0]?.severity).toBe('semantic');
    expect(result.hasContradictions).toBe(true);
  });

  it('does NOT flag compatible observations at the same file:line as contradictions', () => {
    const result = crossValidate([
      rep('scout-schema', [
        {
          file: 'apps/web/src/components/chrome/Sidebar.tsx',
          line: 199,
          fact: 'Sidebar sets the collapsed width class for icon-only layout',
          confidence: 'high',
        },
      ]),
      rep('scout-code-path', [
        {
          file: 'apps/web/src/components/chrome/Sidebar.tsx',
          line: 199,
          fact: 'Collapsed Sidebar uses width styling around the nav item container',
          confidence: 'high',
        },
      ]),
    ]);

    expect(result.contradictions).toHaveLength(0);
    expect(result.hasContradictions).toBe(false);
  });

  it('does NOT flag agreement (same file:line, identical fact) as a contradiction', () => {
    const result = crossValidate([
      rep('scout-schema', [
        { file: 'src/x.ts', line: 10, fact: 'exports default', confidence: 'high' },
      ]),
      rep('scout-code-path', [
        { file: 'src/x.ts', line: 10, fact: 'exports default', confidence: 'medium' },
      ]),
    ]);

    expect(result.contradictions).toHaveLength(0);
    expect(result.hasContradictions).toBe(false);
  });

  it('does NOT flag different file:line as a contradiction', () => {
    const result = crossValidate([
      rep('a', [{ file: 'src/x.ts', line: 1, fact: 'foo', confidence: 'high' }]),
      rep('b', [{ file: 'src/x.ts', line: 2, fact: 'bar', confidence: 'high' }]),
    ]);

    expect(result.contradictions).toHaveLength(0);
  });

  it('does NOT treat file-only wording differences as contradictions', () => {
    const result = crossValidate([
      rep('a', [{ file: 'src/x.ts', fact: 'imports zod', confidence: 'medium' }]),
      rep('b', [{ file: 'src/x.ts', fact: 'imports yup', confidence: 'medium' }]),
    ]);

    expect(result.contradictions).toHaveLength(0);
  });

  it('groups all conflicting scouts at one location into a single contradiction', () => {
    const result = crossValidate([
      rep('a', [{ file: 'src/x.ts', line: 7, fact: 'returns null', confidence: 'high' }]),
      rep('b', [{ file: 'src/x.ts', line: 7, fact: 'does NOT return null', confidence: 'high' }]),
      rep('c', [{ file: 'src/x.ts', line: 7, fact: 'does not return null', confidence: 'medium' }]),
    ]);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.scouts.sort()).toEqual(['a', 'b', 'c']);
    expect(result.contradictions[0]?.facts).toHaveLength(3);
  });

  it('does NOT flag a single scout listing multiple distinct facts at the same file:line', () => {
    // A catalog from one scout is not a contradiction — contradictions are
    // by definition cross-scout disagreement.
    const result = crossValidate([
      rep('scout-pattern', [
        { file: 'src/x.ts', line: 7, fact: 'callsite A', confidence: 'high' },
        { file: 'src/x.ts', line: 7, fact: 'callsite B (overload)', confidence: 'high' },
      ]),
    ]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.hasContradictions).toBe(false);
  });

  it('skips reports whose status is not ok (only ok scouts contribute to cross-validation)', () => {
    const ok: ScoutReport = {
      scoutName: 'ok-1',
      status: 'ok',
      findings: [{ file: 'a.ts', line: 1, fact: 'x', confidence: 'high' }],
      decisionSummaries: [],
      runId: 'r1',
    };
    const failed: ScoutReport = {
      scoutName: 'fail-1',
      status: 'error',
      findings: [{ file: 'a.ts', line: 1, fact: 'NOT x', confidence: 'high' }],
      decisionSummaries: [],
      errorReason: 'boom',
      runId: 'r2',
    };
    const result = crossValidate([ok, failed]);
    // failed scout's findings are ignored; nothing to contradict.
    expect(result.contradictions).toHaveLength(0);
  });
});
