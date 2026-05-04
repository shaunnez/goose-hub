import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runVitest } from './run-vitest.js';

// Spawns a fake "vitest" via a tiny shell script that writes a known JSON
// report to the path supplied via --outputFile, exercising the real spawn /
// tempfile / parse plumbing without needing vitest itself.

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'goose-hub-rv-test-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeFakeRunner(name: string, body: string): string {
  const path = join(workDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

function writeReportScript(report: unknown, exitCode: number): string {
  return [
    'for arg in "$@"; do',
    '  case "$arg" in',
    '    --outputFile=*) out="${arg#--outputFile=}";;',
    '  esac',
    'done',
    `cat <<'JSON' > "$out"`,
    JSON.stringify(report),
    'JSON',
    `exit ${exitCode}`,
  ].join('\n');
}

describe('runVitest', () => {
  it('parses the JSON report written to --outputFile', async () => {
    const report = {
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      success: true,
      startTime: 0,
      testResults: [
        {
          name: 'a.test.ts',
          status: 'passed',
          assertionResults: [
            { status: 'passed', duration: 5 },
            { status: 'passed', duration: 5 },
          ],
        },
      ],
    };
    // Fake binary: extracts the value passed to --outputFile=... and writes the JSON there.
    const runner = writeFakeRunner('fake-vitest.sh', writeReportScript(report, 0));

    const run = await runVitest({ command: runner, cwd: workDir });
    expect(run.total).toBe(2);
    expect(run.passed).toBe(2);
    expect(run.failed).toBe(0);
    expect(run.success).toBe(true);
  });

  it('still parses the report when the runner exits non-zero (failed tests)', async () => {
    const report = {
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      success: false,
      startTime: 0,
      testResults: [
        {
          name: 'b.test.ts',
          status: 'failed',
          assertionResults: [{ status: 'failed', duration: 1 }],
        },
      ],
    };
    const runner = writeFakeRunner('fake-vitest-fail.sh', writeReportScript(report, 1));

    const run = await runVitest({ command: runner, cwd: workDir });
    expect(run.failed).toBe(1);
    expect(run.success).toBe(false);
  });

  it('rejects when the runner does not produce an output file', async () => {
    const runner = writeFakeRunner('fake-vitest-noop.sh', 'exit 0');
    await expect(runVitest({ command: runner, cwd: workDir })).rejects.toThrow();
  });

  it('rejects when the command times out', async () => {
    const runner = writeFakeRunner('fake-vitest-hang.sh', 'sleep 5');
    await expect(runVitest({ command: runner, cwd: workDir, timeoutMs: 100 })).rejects.toThrow(
      /timed out/,
    );
  });
});
