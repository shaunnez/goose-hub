// core/test-runner/run-vitest.ts
// Runs a vitest test command with `--reporter=json` and returns the parsed
// TestRun. Captures wall time deterministically here rather than relying on
// the reporter's startTime so the QA workflow gets accurate timings.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestRun } from '@goose-hub/skills/qa/schema.js';
import { parseVitestJson } from './parse-vitest-json.js';

export interface RunVitestOptions {
  /**
   * Test command as a single shell string (e.g. `pnpm test `).
   * The runner appends `--reporter=json --outputFile=<tmp>` so callers
   * don't need to know the reporter flag.
   */
  command: string;
  cwd: string;
  /** Hard timeout for the test run, in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Runs the given test command with vitest's JSON reporter and parses the
 * output. The command is executed via `sh -c` so callers can pass pipelines
 * or compound commands ("pnpm test "). Vitest is told to write the
 * report to a tempfile (stdout is reserved for log output) which we then
 * read back.
 */
export async function runVitest(opts: RunVitestOptions): Promise<TestRun> {
  const dir = mkdtempSync(join(tmpdir(), 'goose-hub-vitest-'));
  const outFile = join(dir, 'report.json');
  const baseCommand = opts.command.replace(/\s+--reporter(?:=\S+)?/g, '').trimEnd();
  const fullCommand = `${baseCommand} --reporter=json --outputFile=${JSON.stringify(outFile)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('sh', ['-c', fullCommand], {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      });
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `runVitest: test command timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
          ),
        );
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      // vitest exits non-zero on test failure; that's expected — we still
      // want to parse the report. Only reject on missing output file below.
      child.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const raw = JSON.parse(readFileSync(outFile, 'utf8'));
    return parseVitestJson(raw, Date.now());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
