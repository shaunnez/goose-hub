import { describe, expect, it } from 'vitest';
import { parseVitestJson } from './parse-vitest-json.js';

const STAR = 1_700_000_000_000;

const sample = {
  numTotalTestSuites: 2,
  numPassedTestSuites: 1,
  numFailedTestSuites: 1,
  numTotalTests: 5,
  numPassedTests: 3,
  numFailedTests: 1,
  numPendingTests: 1,
  numTodoTests: 0,
  startTime: STAR,
  success: false,
  testResults: [
    {
      name: '/repo/src/cart.test.ts',
      status: 'passed',
      assertionResults: [
        { status: 'passed', duration: 12 },
        { status: 'passed', duration: 18.4 },
        { status: 'pending', duration: 0 },
      ],
    },
    {
      name: '/repo/src/funnel.test.ts',
      status: 'failed',
      assertionResults: [
        { status: 'passed', duration: 7 },
        { status: 'failed', duration: 41 },
      ],
    },
  ],
};

describe('parseVitestJson', () => {
  it('produces canonical TestRun from a vitest JSON report', () => {
    const run = parseVitestJson(sample, STAR + 7700);
    expect(run.wallTimeMs).toBe(7700);
    expect(run.total).toBe(5);
    expect(run.passed).toBe(3);
    expect(run.failed).toBe(1);
    expect(run.skipped).toBe(1);
    expect(run.success).toBe(false);
    expect(run.suites).toHaveLength(2);

    const cart = run.suites[0];
    expect(cart.name).toBe('cart.test.ts');
    expect(cart.filePath).toBe('/repo/src/cart.test.ts');
    expect(cart.total).toBe(3);
    expect(cart.passed).toBe(2);
    expect(cart.failed).toBe(0);
    expect(cart.skipped).toBe(1);
    expect(cart.durationMs).toBe(30); // 12 + 18.4 -> rounded
    expect(cart.status).toBe('passed');

    const funnel = run.suites[1];
    expect(funnel.status).toBe('failed');
    expect(funnel.failed).toBe(1);
  });

  it('marks a suite skipped when no tests passed and at least one is pending', () => {
    const run = parseVitestJson({
      success: true,
      startTime: STAR,
      testResults: [
        {
          name: 'a.test.ts',
          status: 'passed',
          assertionResults: [
            { status: 'pending', duration: 0 },
            { status: 'pending', duration: 0 },
          ],
        },
      ],
    });
    expect(run.suites[0].status).toBe('skipped');
  });

  it('treats success=true with zero failures as a successful run', () => {
    const run = parseVitestJson({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      success: true,
      startTime: STAR,
      testResults: [
        {
          name: 'ok.test.ts',
          status: 'passed',
          assertionResults: [{ status: 'passed', duration: 1 }],
        },
      ],
    });
    expect(run.success).toBe(true);
  });

  it('treats success=true with non-zero failures as failed (defensive)', () => {
    const run = parseVitestJson({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      success: true,
      startTime: STAR,
      testResults: [
        {
          name: 'bad.test.ts',
          status: 'failed',
          assertionResults: [{ status: 'failed', duration: 1 }],
        },
      ],
    });
    expect(run.success).toBe(false);
  });

  it('falls back to summing assertions when top-level totals are missing', () => {
    const run = parseVitestJson({
      success: true,
      startTime: STAR,
      testResults: [
        {
          name: 'x.test.ts',
          status: 'passed',
          assertionResults: [
            { status: 'passed', duration: 5 },
            { status: 'passed', duration: 5 },
          ],
        },
      ],
    });
    expect(run.total).toBe(2);
    expect(run.passed).toBe(2);
    expect(run.failed).toBe(0);
    expect(run.skipped).toBe(0);
  });

  it('throws on non-object input', () => {
    expect(() => parseVitestJson(null as unknown)).toThrow(/expected an object/);
    expect(() => parseVitestJson('not json' as unknown)).toThrow(/expected an object/);
  });

  it('handles an empty report gracefully', () => {
    const run = parseVitestJson({ startTime: STAR, success: true, testResults: [] }, STAR + 100);
    expect(run.total).toBe(0);
    expect(run.passed).toBe(0);
    expect(run.failed).toBe(0);
    expect(run.success).toBe(true);
    expect(run.suites).toEqual([]);
    expect(run.wallTimeMs).toBe(100);
  });

  it('uses now() when startTime is missing', () => {
    const run = parseVitestJson({ success: true, testResults: [] }, STAR + 5);
    expect(run.wallTimeMs).toBe(0);
  });
});
