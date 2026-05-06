import { describe, expect, it, vi } from 'vitest';
import { parseDependencies } from './dependency-parser.js';
import {
  DependencyResolver,
  type FetchTargetFn,
  resolveDependency,
} from './dependency-resolver.js';

// ---------------------------------------------------------------------------
// Empty / no-match cases
// ---------------------------------------------------------------------------

describe('parseDependencies — empty / no-match', () => {
  it('returns empty array for empty body', () => {
    expect(parseDependencies('')).toEqual([]);
  });

  it('returns empty array for whitespace-only body', () => {
    expect(parseDependencies('   \n\n\t')).toEqual([]);
  });

  it('ignores lines without a recognised prefix', () => {
    expect(parseDependencies('This issue is related to #5 but not a dep')).toEqual([]);
  });

  it('ignores a bare #N reference with no prefix', () => {
    expect(parseDependencies('See #42 for context')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Depends-on variants
// ---------------------------------------------------------------------------

describe('parseDependencies — depends-on variants', () => {
  it('parses "Depends on #N" (no colon)', () => {
    expect(parseDependencies('Depends on #42')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 42 },
    ]);
  });

  it('parses "Depends on: #N" (with colon)', () => {
    expect(parseDependencies('Depends on: #42')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 42 },
    ]);
  });

  it('parses "Depends-on #N" (hyphen variant)', () => {
    expect(parseDependencies('Depends-on #7')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 7 },
    ]);
  });

  it('parses "deps: #N"', () => {
    expect(parseDependencies('deps: #15')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 15 },
    ]);
  });

  it('parses "blocked by #N"', () => {
    expect(parseDependencies('blocked by #8')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 8 },
    ]);
  });

  it('parses "blocked-by #N" (hyphen variant)', () => {
    expect(parseDependencies('blocked-by #8')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 8 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Blocks variants
// ---------------------------------------------------------------------------

describe('parseDependencies — blocks variants', () => {
  it('parses "Blocks #N" as blocks type', () => {
    expect(parseDependencies('Blocks #3')).toEqual([
      { type: 'blocks', repoRef: null, issueNumber: 3 },
    ]);
  });

  it('parses "Blocks: #N" (with colon)', () => {
    expect(parseDependencies('Blocks: #3')).toEqual([
      { type: 'blocks', repoRef: null, issueNumber: 3 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cross-repo form
// ---------------------------------------------------------------------------

describe('parseDependencies — cross-repo form', () => {
  it('parses "Depends on owner/repo#N"', () => {
    expect(parseDependencies('Depends on shaunnez/other-repo#12')).toEqual([
      { type: 'depends-on', repoRef: 'shaunnez/other-repo', issueNumber: 12 },
    ]);
  });

  it('parses "Blocks owner/repo#N"', () => {
    expect(parseDependencies('Blocks shaunnez/some-repo#99')).toEqual([
      { type: 'blocks', repoRef: 'shaunnez/some-repo', issueNumber: 99 },
    ]);
  });

  it('mixes same-repo and cross-repo refs on one line', () => {
    expect(parseDependencies('Depends on shaunnez/other-repo#12, #3')).toEqual([
      { type: 'depends-on', repoRef: 'shaunnez/other-repo', issueNumber: 12 },
      { type: 'depends-on', repoRef: null, issueNumber: 3 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Case insensitivity
// ---------------------------------------------------------------------------

describe('parseDependencies — case insensitive', () => {
  it('handles all-caps DEPENDS ON', () => {
    expect(parseDependencies('DEPENDS ON #5')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 5 },
    ]);
  });

  it('handles all-caps BLOCKS', () => {
    expect(parseDependencies('BLOCKS #10')).toEqual([
      { type: 'blocks', repoRef: null, issueNumber: 10 },
    ]);
  });

  it('handles all-caps DEPS', () => {
    expect(parseDependencies('DEPS: #5')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 5 },
    ]);
  });

  it('handles mixed case Blocked By', () => {
    expect(parseDependencies('Blocked By #4')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 4 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Whitespace tolerance
// ---------------------------------------------------------------------------

describe('parseDependencies — whitespace tolerance', () => {
  it('handles leading whitespace on dep lines', () => {
    expect(parseDependencies('  Depends on #9')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 9 },
    ]);
  });

  it('handles trailing whitespace on dep lines', () => {
    expect(parseDependencies('Depends on #9   ')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 9 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Multiple deps
// ---------------------------------------------------------------------------

describe('parseDependencies — multiple deps', () => {
  it('parses multiple dep lines across a full body', () => {
    const body = ['Some description.', '', 'Depends on #1', 'Depends on #2', 'Blocks #3'].join(
      '\n',
    );
    expect(parseDependencies(body)).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 1 },
      { type: 'depends-on', repoRef: null, issueNumber: 2 },
      { type: 'blocks', repoRef: null, issueNumber: 3 },
    ]);
  });

  it('parses multiple refs on a single line', () => {
    expect(parseDependencies('Depends on #1, #2, #3')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 1 },
      { type: 'depends-on', repoRef: null, issueNumber: 2 },
      { type: 'depends-on', repoRef: null, issueNumber: 3 },
    ]);
  });

  it('handles mixed types and cross-repo in a real-world body', () => {
    const body = [
      '## Context',
      '',
      'This issue depends on the parser and the resolver.',
      '',
      '## Depends on',
      '',
      '- #286',
      '- #291',
    ].join('\n');

    // The "## Depends on" heading line has no ref, and the "- #286" lines
    // don't start with a recognised prefix — this is deliberate: the parser
    // only reads lines that start with the prefix.  The section-header style
    // is handled by the resolver/scheduler consuming WorkItem.dependsOn.
    expect(parseDependencies(body)).toEqual([]);
  });

  it('handles the actual GitHub issue body format with prefix on each line', () => {
    const body = ['## Depends on', '', 'Depends on #286', 'Depends on #291'].join('\n');
    expect(parseDependencies(body)).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 286 },
      { type: 'depends-on', repoRef: null, issueNumber: 291 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Malformed / no-crash guarantees
// ---------------------------------------------------------------------------

describe('parseDependencies — malformed input', () => {
  it('silently skips lines with prefix but no valid ref', () => {
    expect(parseDependencies('Depends on nothing')).toEqual([]);
  });

  it('silently skips lines with prefix and malformed ref (letters only)', () => {
    expect(parseDependencies('Depends on #abc')).toEqual([]);
  });

  it('does not crash on a body with only newlines', () => {
    expect(parseDependencies('\n\n\n')).toEqual([]);
  });

  it('does not include NaN issue numbers', () => {
    const result = parseDependencies('Depends on #');
    expect(result).toEqual([]);
  });

  it('rejects alphanumeric suffixes — #123abc must not match as 123', () => {
    expect(parseDependencies('Depends on #123abc')).toEqual([]);
  });

  it('rejects cross-repo ref with alphanumeric suffix — owner/repo#12foo', () => {
    expect(parseDependencies('Depends on shaunnez/other-repo#12foo')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: parser → resolver
// ---------------------------------------------------------------------------

describe('slice — parser feeds resolver end-to-end', () => {
  it('resolves all parsed deps from a real-world body, batching same-repo and cross-repo', async () => {
    const body = [
      'Depends on #286',
      'Depends on shaunnez/other-repo#12',
      'Depends on stranger/elsewhere#9',
    ].join('\n');

    const refs = parseDependencies(body);

    const fetchTarget: FetchTargetFn = async (repoRef, n) => {
      if (repoRef === 'shaunnez/goose-hub' && n === 286)
        return { state: 'closed', title: 'parser' };
      if (repoRef === 'shaunnez/other-repo' && n === 12) return { state: 'open', title: 'across' };
      return null; // stranger/elsewhere — unregistered
    };

    const resolver = new DependencyResolver({
      currentRepo: 'shaunnez/goose-hub',
      fetchTarget,
    });

    const resolved = await Promise.all(refs.map((r) => resolver.resolve(r)));

    expect(resolved).toMatchObject([
      { state: 'closed', repoRef: 'shaunnez/goose-hub', issueNumber: 286, title: 'parser' },
      { state: 'open', repoRef: 'shaunnez/other-repo', issueNumber: 12, title: 'across' },
      { state: 'unregistered', repoRef: 'stranger/elsewhere', issueNumber: 9 },
    ]);
  });

  it('resolveDependency convenience function handles a single ref', async () => {
    const fetchTarget = vi.fn<FetchTargetFn>(async () => ({ state: 'closed', title: 't' }));
    const result = await resolveDependency(
      { type: 'depends-on', repoRef: null, issueNumber: 1 },
      { currentRepo: 'shaunnez/goose-hub', fetchTarget },
    );
    expect(result.state).toBe('closed');
  });
});
