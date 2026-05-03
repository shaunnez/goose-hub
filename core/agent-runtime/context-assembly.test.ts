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

  it('projects dotted-path sub-keys from nested objects', () => {
    const { contextXml } = assembleSpawnContext(
      makeSpec(
        { workItem: { title: 'Fix bug', body: 'Details', number: 42, priority: 'low' } },
        ['workItem.title', 'workItem.body'],
      ),
    );
    // JSON keys are XML-escaped: " → &quot;
    expect(contextXml).toContain('<workItem>');
    expect(contextXml).toContain('&quot;title&quot;');
    expect(contextXml).toContain('&quot;body&quot;');
    expect(contextXml).not.toContain('&quot;number&quot;');
    expect(contextXml).not.toContain('&quot;priority&quot;');
  });

  it('includes full nested object when top-level key is in allowlist', () => {
    const { contextXml } = assembleSpawnContext(
      makeSpec({ workItem: { title: 'Fix bug', body: 'Details' } }, ['workItem']),
    );
    expect(contextXml).toContain('<workItem>');
    expect(contextXml).toContain('&quot;title&quot;');
    expect(contextXml).toContain('&quot;body&quot;');
  });

  it('handles implement-style mixed allowlist (dotted + scalar)', () => {
    const context = {
      projectId: 'proj-1',
      workItemId: 'wi-1',
      workItem: { title: 'Add emoji', body: 'Add task', number: 258, priority: 'low' },
      worktreePath: '/tmp/ws',
      stack: { testCommand: 'pnpm test', lintCommand: 'pnpm lint' },
      advisorFeedback: undefined,
      revisionPass: 0,
    };
    const allowlist = [
      'workItem.title',
      'workItem.body',
      'workItem.number',
      'workItem.priority',
      'worktreePath',
      'stack.testCommand',
      'stack.lintCommand',
      'advisorFeedback',
      'revisionPass',
    ];
    const { contextXml } = assembleSpawnContext(makeSpec(context, allowlist));
    expect(contextXml).toContain('<workItem>');
    expect(contextXml).toContain('Add emoji');
    expect(contextXml).toContain('<worktreePath>');
    expect(contextXml).toContain('<stack>');
    expect(contextXml).toContain('pnpm test');
    expect(contextXml).not.toContain('projectId');
    expect(contextXml).not.toContain('workItemId');
    expect(contextXml).not.toContain('advisorFeedback');
  });
});
