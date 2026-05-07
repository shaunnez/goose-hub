/**
 * bootstrapCommand — M12.06
 *
 * Extracted from apps/cli/src/index.ts so that the slice test can import it
 * without pulling in the heavy deps (drizzle, target-projects, agent-runtime)
 * that live in index.ts.
 *
 * The function accepts all I/O as injected deps so it is fully unit-testable
 * without mocking process globals.
 *
 * cloneRoot default: process.cwd()
 *
 * Rationale: the bootstrap workflow needs a local clone root to inspect the
 * target repo's filesystem (stack detection, CLAUDE.md audit). Using
 * process.cwd() means "bootstrap into whatever directory the user is already
 * in" — the most common and least surprising default for a CLI tool. An
 * operator who wants all clones in one place can set FACTORY_CLONE_ROOT.
 */

import type { BootstrapResult } from '@goose-hub/core/workflows/bootstrap-project.js';

// ---------------------------------------------------------------------------
// Public interface (testable without spawning the real workflow)
// ---------------------------------------------------------------------------

export interface BootstrapCommandDeps {
  /** The full process.argv (or equivalent test array). */
  argv: string[];
  /** The process environment (or a subset). */
  env: Record<string, string | undefined>;
  /**
   * The workflow function to invoke.  Defaults to the real bootstrapProject
   * when called from index.ts, but tests inject a mock.
   */
  runWorkflow: (input: {
    repoRef: string;
    token: string;
    cloneRoot: string;
  }) => Promise<BootstrapResult>;
  /** Write a line to stdout. */
  write: (line: string) => void;
  /** Write a line to stderr. */
  writeErr: (line: string) => void;
}

/**
 * Core logic for `goose project bootstrap <owner>/<repo>`.
 *
 * Returns 0 on success (status 'created' or 'idempotent-skip'),
 * 1 on any error or invalid input.
 */
export async function bootstrapCommand(deps: BootstrapCommandDeps): Promise<number> {
  const { argv, env, runWorkflow, write, writeErr } = deps;

  // argv: ['node', 'goose', 'project', 'bootstrap', '<owner>/<repo>']
  // The caller (index.ts) passes process.argv, so argv[0] is node, argv[1]
  // is the script, and the positional args start at argv[2]. For the
  // `project bootstrap` dispatch, the remaining args are passed as:
  //   argv = ['node', 'script', 'project', 'bootstrap', '<repo>']
  // or (from index.ts slicing `args.slice(1)` after the 'bootstrap' subcommand):
  //   argv = ['goose', 'project', 'bootstrap', '<repo>']
  // We find the repoRef as the first non-flag arg after 'bootstrap'.
  const bootstrapIdx = argv.indexOf('bootstrap');
  const repoRef = bootstrapIdx >= 0 ? (argv[bootstrapIdx + 1] ?? '') : '';

  if (!repoRef) {
    writeErr('Usage: goose project bootstrap <owner>/<repo>');
    writeErr('  Example: goose project bootstrap acme/my-service');
    return 1;
  }

  // Validate owner/repo shape
  const parts = repoRef.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    writeErr(`Error: repoRef must be in "owner/repo" format, got: ${repoRef}`);
    writeErr('Usage: goose project bootstrap <owner>/<repo>');
    return 1;
  }

  // Validate GitHub token
  const token = env.GITHUB_TOKEN;
  if (!token) {
    writeErr('Error: GITHUB_TOKEN env var is not set.');
    writeErr('  Set GITHUB_TOKEN to a GitHub PAT with repo scope:');
    writeErr('    export GITHUB_TOKEN=ghp_…');
    return 1;
  }

  // Resolve clone root (see module JSDoc for rationale)
  const cloneRoot = env.FACTORY_CLONE_ROOT ?? process.cwd();

  write(`Bootstrapping ${repoRef} …`);
  write(`  clone root: ${cloneRoot}`);

  let result: BootstrapResult;
  try {
    result = await runWorkflow({ repoRef, token, cloneRoot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeErr(`Error: ${msg}`);
    if (err instanceof Error && err.name === 'BootstrapInputError') {
      writeErr('  Check that <owner>/<repo> is a valid GitHub repository reference.');
    }
    return 1;
  }

  if (result.status === 'idempotent-skip') {
    write('');
    write('Already registered — an existing registration PR was found.');
    write(`  PR URL: ${result.registrationPrUrl ?? '(unknown)'}`);
    write('');
    write('No changes were made. Merge or review the existing PR.');
    return 0;
  }

  // status === 'created'
  write('');
  write(`Stack detected:   ${result.stackSummary}`);
  write(`CLAUDE.md audit:  ${result.auditAction}`);
  if (result.labelCounts) {
    const { created, updated, skipped } = result.labelCounts;
    write(`Labels installed: created: ${created}, updated: ${updated}, skipped: ${skipped}`);
  }
  write('');
  write('Registration PR opened:');
  write(`  ${result.registrationPrUrl}`);
  write('');
  write('Next steps:');
  write('  1. Review and merge the registration PR above.');
  write('  2. Set up the GitHub webhook on the target repo:');
  write('       docs/runbooks/webhook-setup.md');
  write('  3. Confirm the server logs an `ingest.event-received` event after saving the webhook.');

  return 0;
}
