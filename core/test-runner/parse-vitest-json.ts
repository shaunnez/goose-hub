// core/test-runner/parse-vitest-json.ts
// Parses vitest's `--reporter=json` output into a runner-agnostic TestRun.
//
// Pure function over JSON: no I/O. Pair with run-vitest.ts to actually
// invoke vitest and feed the raw JSON in here.

import { basename } from 'node:path';
import type { SuiteResult, TestRun } from '@goose-hub/skills/qa/schema.js';

type SuiteStatus = SuiteResult['status'];

interface VitestAssertion {
  status: string;
  duration?: number | null;
}

interface VitestTestResult {
  name: string;
  status: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: VitestAssertion[];
}

interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  startTime?: number;
  success?: boolean;
  testResults?: VitestTestResult[];
}

function classifySuite(passed: number, failed: number, total: number): SuiteStatus {
  if (failed > 0) return 'failed';
  if (passed === 0 && total > 0) return 'skipped';
  return 'passed';
}

/** Parse a vitest `--reporter=json` payload into the canonical TestRun shape. */
export function parseVitestJson(raw: unknown, now: number = Date.now()): TestRun {
  if (raw == null || typeof raw !== 'object') {
    throw new Error('parseVitestJson: expected an object');
  }
  const report = raw as VitestJsonReport;
  const results = report.testResults ?? [];

  const suites: SuiteResult[] = results.map((r) => {
    const assertions = r.assertionResults ?? [];
    const passed = assertions.filter((a) => a.status === 'passed').length;
    const failed = assertions.filter((a) => a.status === 'failed').length;
    const skipped = assertions.filter(
      (a) => a.status === 'skipped' || a.status === 'pending' || a.status === 'todo',
    ).length;
    const total = assertions.length;
    const durationMs = assertions.reduce((sum, a) => sum + (a.duration ?? 0), 0);
    return {
      name: basename(r.name || 'unknown'),
      filePath: r.name || '',
      total,
      passed,
      failed,
      skipped,
      durationMs: Math.round(durationMs),
      status: classifySuite(passed, failed, total),
    };
  });

  const total = report.numTotalTests ?? suites.reduce((s, x) => s + x.total, 0);
  const passed = report.numPassedTests ?? suites.reduce((s, x) => s + x.passed, 0);
  const failed = report.numFailedTests ?? suites.reduce((s, x) => s + x.failed, 0);
  const skipped =
    (report.numPendingTests ?? 0) +
    (report.numTodoTests ?? 0) +
    (report.numPendingTests == null && report.numTodoTests == null
      ? suites.reduce((s, x) => s + x.skipped, 0)
      : 0);

  const startTime = report.startTime ?? now;
  const wallTimeMs = Math.max(0, Math.round(now - startTime));

  return {
    wallTimeMs,
    total,
    passed,
    failed,
    skipped,
    success: report.success === true && failed === 0,
    suites,
  };
}
