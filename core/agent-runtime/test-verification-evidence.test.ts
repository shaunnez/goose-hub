import type { AgentEvent } from '@goose-hub/core/event-stream/store.js';
import { describe, expect, it } from 'vitest';
import {
  collectReportedRunTestFailures,
  collectWrittenTestVerificationFailures,
  formatWrittenTestVerificationFailure,
  hasSuccessfulVerificationToolCall,
} from './test-verification-evidence.js';

function toolEvent(
  id: number,
  toolName: string,
  status: string,
  path: string,
  extraInput: Record<string, unknown> = {},
): AgentEvent {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item-1',
    kind: 'agent.tool-call',
    runId: 'run-1',
    createdAt: new Date(id * 1000).toISOString(),
    payload: {
      tool_name: toolName,
      status,
      raw_path: path,
      tool_input: { path, paths: [path], ...extraInput },
    },
  };
}

describe('test verification evidence', () => {
  it('requires written test verification after the last edit', () => {
    const events = [
      toolEvent(1, 'run_tests', 'ok', 'apps/web/src/foo.test.ts'),
      toolEvent(2, 'edit_file', 'ok', 'apps/web/src/foo.test.ts'),
    ];

    const failures = collectWrittenTestVerificationFailures(events, ['apps/web/src/foo.test.ts']);

    expect(formatWrittenTestVerificationFailure(failures)).toContain('apps/web/src/foo.test.ts');
  });

  it('accepts a parent-directory run_tests pass after the last edit', () => {
    const events = [
      toolEvent(1, 'edit_file', 'ok', 'apps/web/src/foo.test.ts'),
      toolEvent(2, 'run_tests', 'ok', 'apps/web/src'),
    ];

    const failures = collectWrittenTestVerificationFailures(events, ['apps/web/src/foo.test.ts']);

    expect(formatWrittenTestVerificationFailure(failures)).toBeNull();
  });

  it('uses exact Playwright or e2e package-script evidence for written e2e specs', () => {
    const specPath = 'apps/web/e2e/issue-1151.spec.ts';
    const events = [
      toolEvent(1, 'edit_file', 'ok', specPath),
      toolEvent(2, 'run_package_script', 'ok', specPath, { script: `test:e2e ${specPath}` }),
    ];

    const failures = collectWrittenTestVerificationFailures(events, [specPath]);

    expect(formatWrittenTestVerificationFailure(failures)).toBeNull();
    expect(hasSuccessfulVerificationToolCall(events)).toBe(true);
  });

  it('accepts parent-directory run_tests passes for reported non-written test paths', () => {
    const events = [toolEvent(1, 'run_tests', 'ok', 'apps/web/src')];

    expect(
      collectReportedRunTestFailures({
        events,
        reportedRunPaths: ['apps/web/src/foo.test.ts'],
      }),
    ).toEqual([]);
  });

  it('requires reported non-written test verification after the last matching edit', () => {
    const events = [
      toolEvent(1, 'run_tests', 'ok', 'apps/web/src'),
      toolEvent(2, 'edit_file', 'ok', 'apps/web/src/foo.test.ts'),
    ];

    expect(
      collectReportedRunTestFailures({
        events,
        reportedRunPaths: ['apps/web/src/foo.test.ts'],
      }),
    ).toEqual(['apps/web/src/foo.test.ts']);
  });
});
