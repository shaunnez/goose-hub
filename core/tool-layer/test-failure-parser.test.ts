import { describe, expect, it } from 'vitest';
import { parseTestFailures } from './test-failure-parser.js';

const VITEST_JSON_FAIL = JSON.stringify({
  numTotalTestSuites: 1,
  numTotalTests: 3,
  numPassedTests: 1,
  numFailedTests: 2,
  testResults: [
    {
      name: '/work/apps/web/src/foo.test.ts',
      status: 'failed',
      assertionResults: [
        {
          ancestorTitles: ['ChatPanel', 'close'],
          title: 'resets to list view on reopen',
          status: 'failed',
          failureMessages: [
            'AssertionError: expected list view to be visible\n    at /work/apps/web/src/foo.test.ts:42:12',
          ],
        },
        {
          ancestorTitles: [],
          title: 'cleans up timer',
          status: 'passed',
          failureMessages: [],
        },
        {
          ancestorTitles: ['ChatPanel', 'open'],
          title: 'restores cursor focus',
          status: 'failed',
          failureMessages: ['Error: timeout of 5000ms exceeded'],
        },
      ],
    },
  ],
});

describe('parseTestFailures (Vitest JSON)', () => {
  it('extracts failed tests with assertions, file, line, category', () => {
    const result = parseTestFailures({ stdout: VITEST_JSON_FAIL, stderr: '' });
    expect(result.parserUsed).toBe('vitest-json');
    expect(result.summary).toEqual({ total: 3, passed: 1, failed: 2 });
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({
      testName: 'ChatPanel > close > resets to list view on reopen',
      file: '/work/apps/web/src/foo.test.ts',
      line: 42,
      category: 'assertion',
    });
    expect(result.failures[0].assertion).toContain('AssertionError');
    expect(result.failures[1]).toMatchObject({
      testName: 'ChatPanel > open > restores cursor focus',
      category: 'timeout',
    });
  });

  it('caps failures at 5 and reports truncation', () => {
    const manyFailures = JSON.stringify({
      numTotalTests: 12,
      numPassedTests: 0,
      numFailedTests: 12,
      testResults: [
        {
          name: '/work/x.test.ts',
          status: 'failed',
          assertionResults: Array.from({ length: 12 }, (_, i) => ({
            ancestorTitles: [],
            title: `case ${i}`,
            status: 'failed',
            failureMessages: ['AssertionError: nope'],
          })),
        },
      ],
    });
    const result = parseTestFailures({ stdout: manyFailures, stderr: '' });
    expect(result.parserUsed).toBe('vitest-json');
    expect(result.failures).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('tolerates preamble lines before the JSON object', () => {
    const noisy = `> pnpm test\n> some pre-test hook output\n${VITEST_JSON_FAIL}\nDone in 2.3s`;
    const result = parseTestFailures({ stdout: noisy, stderr: '' });
    expect(result.parserUsed).toBe('vitest-json');
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

describe('parseTestFailures (text fallback)', () => {
  it('falls back to text scanning when JSON is absent', () => {
    const text = `
 FAIL  apps/web/src/foo.test.ts > suite > does the thing
  × suite > does the thing
    AssertionError: expected 1 to equal 2
`;
    const result = parseTestFailures({ stdout: text, stderr: '' });
    expect(result.parserUsed).toBe('vitest-text');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      file: 'apps/web/src/foo.test.ts',
      category: 'unknown',
    });
  });
});

describe('parseTestFailures (no signal)', () => {
  it('returns parserUsed: unknown with empty failures when nothing parses', () => {
    const result = parseTestFailures({ stdout: 'some unrelated output', stderr: '' });
    expect(result.parserUsed).toBe('unknown');
    expect(result.failures).toEqual([]);
  });
});
