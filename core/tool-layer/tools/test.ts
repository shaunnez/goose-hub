import { type RepoRelativePath, canonicalizeFactoryToolPaths } from '../path-contract.js';
import type { BashResult } from './bash.js';
import { runBash } from './bash.js';
import { SandboxViolationError } from './read.js';

export interface TestResult extends BashResult {
  /** True when the test command exited with code 0. */
  passed: boolean;
  /** Canonical repo-relative test paths supplied by the caller, if any. */
  paths: RepoRelativePath[];
}

interface RunTestsParams {
  /** Absolute path to the workspace root. cwd for the child process. */
  workspaceRoot: string;
  /**
   * The project's test command (from `StackConfig.testCommand`), e.g.
   * `"pnpm test"` or `"npm run test"`. Tokenised on whitespace into argv.
   */
  testCommand: string;
  /** Optional test files covered by the command. Returned in canonical repo-relative form. */
  paths?: string[];
  /** Optional override of the timeout (ms). Defaults to 5 minutes for test runs. */
  timeoutMs?: number;
}

const DEFAULT_TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — tests legitimately take longer than 30 s

/**
 * Runs the project's `testCommand` from the workspace root and returns a
 * structured pass/fail result.
 *
 * Tokenisation: `testCommand` is split on whitespace. Quoted arguments are
 * NOT supported — projects with complex commands should wrap them in a
 * package.json script (`pnpm test`, `npm run test`, etc.) and pass the
 * script invocation here.
 *
 * Delegates to `runBash`, so the bash denylist applies.
 *
 * @throws {SandboxViolationError} on empty / unsafe testCommand.
 */
export async function runTests(params: RunTestsParams): Promise<TestResult> {
  const { workspaceRoot, testCommand, paths = [], timeoutMs = DEFAULT_TEST_TIMEOUT_MS } = params;

  if (testCommand.trim().length === 0) {
    throw new SandboxViolationError('testCommand must not be empty');
  }
  const canonicalPaths = canonicalizeFactoryToolPaths({
    rawPaths: paths,
    worktreePath: workspaceRoot,
    referencePaths: paths,
  }).map((result) => {
    if (!result.ok) {
      throw new SandboxViolationError(result.error.message);
    }
    return result.path;
  });

  const argv = testCommand.trim().split(/\s+/);
  const result = await runBash({ workspaceRoot, argv, timeoutMs });

  return { ...result, passed: result.exitCode === 0, paths: canonicalPaths };
}
