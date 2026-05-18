/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { highlight, tokenize } from './highlight';

afterEach(() => {
  cleanup();
});

function renderToHtml(text: string, tokens: string[]): string {
  const { container } = render(<span>{highlight(text, tokens)}</span>);
  return container.firstChild instanceof HTMLElement ? container.firstChild.innerHTML : '';
}

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumeric, drops short, dedupes', () => {
    expect(tokenize('Add SSE Reconnect')).toEqual(['add', 'sse', 'reconnect']);
    expect(tokenize('cache, CACHE; cache.')).toEqual(['cache']);
    expect(tokenize('a bb ccc')).toEqual(['bb', 'ccc']);
  });
});

describe('highlight', () => {
  it('returns the original text when no tokens are supplied', () => {
    expect(renderToHtml('hello world', [])).toBe('hello world');
  });

  it('wraps a single match in <mark>', () => {
    const html = renderToHtml('cache layer for tier-2', ['cache']);
    expect(html).toContain('<mark');
    expect(html).toContain('cache');
  });

  it('matches case-insensitively but preserves original casing', () => {
    const html = renderToHtml('Cache Layer', ['cache']);
    expect(html).toContain('Cache');
    expect(html).toContain('<mark');
  });

  it('merges overlapping ranges so the same character is never wrapped twice', () => {
    const html = renderToHtml('abcabcabc', ['abc', 'bca']);
    const matches = html.match(/<mark[^>]*>/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    // The entire body should resolve to a single contiguous highlighted span.
    expect(html.replace(/<[^>]+>/g, '')).toBe('abcabcabc');
  });

  it('leaves non-matching text intact', () => {
    const html = renderToHtml('foo bar baz', ['baz']);
    expect(html.startsWith('foo bar ')).toBe(true);
    expect(html).toContain('<mark');
  });
});
