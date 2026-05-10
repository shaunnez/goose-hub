import { describe, expect, it } from 'vitest';
import { renderContext } from './context-renderer.js';

describe('renderContext', () => {
  it('returns empty task element when allowlist is empty', () => {
    expect(renderContext({ a: 'hello' }, [])).toBe('<task></task>');
  });

  it('returns empty task element when all values are undefined', () => {
    expect(renderContext({ a: undefined }, ['a'])).toBe('<task></task>');
  });

  it('renders a string value as escaped XML', () => {
    const xml = renderContext({ title: 'hello <world>' }, ['title']);
    expect(xml).toContain('hello &lt;world&gt;');
  });

  it('escapes ampersands', () => {
    const xml = renderContext({ title: 'foo & bar' }, ['title']);
    expect(xml).toContain('foo &amp; bar');
  });

  it('escapes double quotes', () => {
    const xml = renderContext({ title: '"quoted"' }, ['title']);
    expect(xml).toContain('&quot;quoted&quot;');
  });

  it('escapes single quotes', () => {
    const xml = renderContext({ title: "it's" }, ['title']);
    expect(xml).toContain('it&apos;s');
  });

  it('renders non-string values as JSON', () => {
    const xml = renderContext({ count: 42 }, ['count']);
    expect(xml).toContain('<count>42</count>');
  });

  it('omits keys not in allowlist silently', () => {
    const xml = renderContext({ a: 'visible', b: 'hidden' }, ['a']);
    expect(xml).toContain('<a>');
    expect(xml).not.toContain('<b>');
  });

  it('projects dotted-path sub-keys from nested objects', () => {
    const xml = renderContext(
      { workItem: { title: 'Fix bug', body: 'Details', number: 42, priority: 'low' } },
      ['workItem.title', 'workItem.body'],
    );
    expect(xml).toContain('<workItem>');
    expect(xml).toContain('&quot;title&quot;');
    expect(xml).toContain('&quot;body&quot;');
    expect(xml).not.toContain('&quot;number&quot;');
    expect(xml).not.toContain('&quot;priority&quot;');
  });

  it('includes full nested object when top-level key is in allowlist', () => {
    const xml = renderContext({ workItem: { title: 'Fix bug', body: 'Details' } }, ['workItem']);
    expect(xml).toContain('<workItem>');
    expect(xml).toContain('&quot;title&quot;');
    expect(xml).toContain('&quot;body&quot;');
  });

  it('handles mixed dotted and scalar allowlist', () => {
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
    const xml = renderContext(context, allowlist);
    expect(xml).toContain('<workItem>');
    expect(xml).toContain('Add emoji');
    expect(xml).toContain('<worktreePath>');
    expect(xml).toContain('<stack>');
    expect(xml).toContain('pnpm test');
    expect(xml).not.toContain('projectId');
    expect(xml).not.toContain('workItemId');
    expect(xml).not.toContain('advisorFeedback');
  });

  it('returns empty task element when dotted key points to non-object', () => {
    // dotted path on a scalar value — projected object would be empty
    const xml = renderContext({ workItem: 'not-an-object' }, ['workItem.title']);
    // workItem is not an object, so dottedSubKey branch is skipped, key is omitted
    expect(xml).toBe('<task></task>');
  });

  it('wraps multiple keys in task block', () => {
    const xml = renderContext({ a: '1', b: '2' }, ['a', 'b']);
    expect(xml).toMatch(/^<task>\n.*<\/task>$/s);
    expect(xml).toContain('<a>1</a>');
    expect(xml).toContain('<b>2</b>');
  });
});
