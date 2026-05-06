import { describe, expect, it } from 'vitest';
import { parseAcceptanceCriteria } from './parse-acceptance.js';

const THREE_ACS = `
## Acceptance criteria

- [ ] First AC with full verify block
      Verify: pnpm test 
      Expected: 5 tests passed
      Tolerance: exact

- [ ] Second AC with full verify block
      Verify: pnpm biome check .
      Expected: Checked 10 files. No fixes applied.
      Tolerance: contains

- [ ] Third AC with no verify block at all
`;

const PARTIAL_BLOCK = `
## Acceptance criteria

- [ ] AC with only Verify and Expected, no Tolerance
      Verify: pnpm test
      Expected: all pass
`;

const MIXED_CHECKED = `
## Acceptance criteria

- [x] Already done AC
      Verify: echo done
      Expected: done
      Tolerance: exact

- [ ] Not done AC
      Verify: pnpm typecheck
      Expected: no errors
      Tolerance: exact
`;

describe('parseAcceptanceCriteria', () => {
  it('returns an empty array for an empty body', () => {
    expect(parseAcceptanceCriteria('')).toEqual([]);
  });

  it('returns an empty array when no AC lines are present', () => {
    const body = '## Context\n\nThis is the problem description.\n';
    expect(parseAcceptanceCriteria(body)).toEqual([]);
  });

  it('parses a single AC with a full verify block', () => {
    const body =
      '- [ ] Thing works\n      Verify: pnpm test\n      Expected: pass\n      Tolerance: exact';
    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ac: 'Thing works',
      command: 'pnpm test',
      expected: 'pass',
      tolerance: 'exact',
    });
  });

  it('skips ACs that have no verify block and returns the ones that do', () => {
    const result = parseAcceptanceCriteria(THREE_ACS);
    expect(result).toHaveLength(2);
    expect(result[0].ac).toBe('First AC with full verify block');
    expect(result[1].ac).toBe('Second AC with full verify block');
  });

  it('skips ACs with a partial block (Verify + Expected but no Tolerance)', () => {
    const result = parseAcceptanceCriteria(PARTIAL_BLOCK);
    expect(result).toHaveLength(0);
  });

  it('parses both checked [x] and unchecked [ ] ACs', () => {
    const result = parseAcceptanceCriteria(MIXED_CHECKED);
    expect(result).toHaveLength(2);
    expect(result[0].ac).toBe('Already done AC');
    expect(result[1].ac).toBe('Not done AC');
  });

  it('trims whitespace from all extracted fields', () => {
    const body =
      '- [ ] Trimming test\n  Verify:   pnpm test   \n  Expected:   pass   \n  Tolerance:   exact   ';
    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('pnpm test');
    expect(result[0].expected).toBe('pass');
    expect(result[0].tolerance).toBe('exact');
  });

  it('handles extra blank lines between the AC text and verify fields', () => {
    const body =
      '- [ ] AC with blank lines\n\n      Verify: pnpm build\n      Expected: built ok\n      Tolerance: contains';
    const result = parseAcceptanceCriteria(body);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('pnpm build');
  });

  it('extracts the correct command from multi-AC body', () => {
    const result = parseAcceptanceCriteria(THREE_ACS);
    expect(result[0].command).toBe('pnpm test');
    expect(result[1].command).toBe('pnpm biome check .');
  });

  it('returns an empty array when body has no verify blocks at all', () => {
    const body = '- [ ] AC one\n- [ ] AC two\n- [ ] AC three\n';
    expect(parseAcceptanceCriteria(body)).toHaveLength(0);
  });
});
