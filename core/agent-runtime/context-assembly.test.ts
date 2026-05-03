import { describe, expect, it } from 'vitest';
import { assembleSpawnContext } from './context-assembly.js';

function makeSpec(context: Record<string, unknown>, allowlist: string[]) {
  return {
    runId: 'r1',
    role: 'developer' as const,
    skill: 'implement',
    context,
    contextAllowlist: allowlist,
    freshContext: true,
    toolBundles: [] as string[],
    toolExtras: [] as never[],
    budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    personaId: 'p1',
    outputJsonSchema: {},
    appendSystemPrompt: '',
  };
}

describe('assembleSpawnContext', () => {
  it('renders string values as escaped XML', () => {
    const { contextXml } = assembleSpawnContext(makeSpec({ title: 'hello <world>' }, ['title']));
    expect(contextXml).toContain('hello &lt;world&gt;');
  });

  it('renders non-string values as JSON', () => {
    const { contextXml } = assembleSpawnContext(makeSpec({ count: 42 }, ['count']));
    expect(contextXml).toContain('<count>42</count>');
  });

  it('skips undefined values instead of crashing', () => {
    expect(() =>
      assembleSpawnContext(
        makeSpec({ advisorFeedback: undefined, worktreePath: '/tmp/x' }, [
          'advisorFeedback',
          'worktreePath',
        ]),
      ),
    ).not.toThrow();
  });

  it('omits undefined values from the rendered XML', () => {
    const { contextXml } = assembleSpawnContext(
      makeSpec({ advisorFeedback: undefined, worktreePath: '/tmp/x' }, [
        'advisorFeedback',
        'worktreePath',
      ]),
    );
    expect(contextXml).not.toContain('advisorFeedback');
    expect(contextXml).toContain('worktreePath');
  });

  it('returns empty task element when all values are filtered out', () => {
    const { contextXml } = assembleSpawnContext(
      makeSpec({ advisorFeedback: undefined }, ['advisorFeedback']),
    );
    expect(contextXml).toBe('<task></task>');
  });

  it('excludes keys not in allowlist', () => {
    const { contextXml } = assembleSpawnContext(makeSpec({ a: 'visible', b: 'hidden' }, ['a']));
    expect(contextXml).toContain('<a>');
    expect(contextXml).not.toContain('<b>');
  });
});
