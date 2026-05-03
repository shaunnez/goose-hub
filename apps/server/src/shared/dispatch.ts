import { join } from 'node:path';
import { logger } from '@goose-hub/core/logger.js';
import { getSourceForSlug } from './source.js';

/**
 * Centralised workflow dispatcher (#207). Domains never import from sibling
 * domains (STANDARDS.md). Webhooks, the projects router, and any other
 * caller that needs to kick off a workflow goes through these helpers.
 *
 * Implementation note: workflow modules are dynamic-imported here (one
 * indirection layer above the previous `webhooks → workflows` direct
 * import). The webhook handler now depends only on `shared/`, which is
 * domain-agnostic.
 */

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** Run the triage batch for a project. Best-effort — errors are logged. */
export function dispatchTriageBatch(slug: string): Promise<void> {
  return import('../domains/workflows/triage-batch.js')
    .then(({ runTriageBatch }) => runTriageBatch(slug))
    .catch((err: unknown) => {
      logger.error('dispatchTriageBatch failed', { slug, error: String(err) });
    });
}

/** Run the investigate workflow for a single issue. */
export async function dispatchInvestigate(slug: string, issueNumber: number): Promise<void> {
  const { runInvestigateWorkflow } = (await import(
    new URL('../../../../slices/investigate/workflow.js', import.meta.url).href
  )) as {
    runInvestigateWorkflow: (
      item: unknown,
      source: unknown,
      slug: string,
      repoRoot: string,
    ) => Promise<unknown>;
  };
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchInvestigate: no source for slug', { slug });
    return;
  }
  const item = await source.getItem(issueNumber.toString());
  await runInvestigateWorkflow(item, source, slug, REPO_ROOT);
}

/** Run the M7 fix-issue workflow for a single issue (#183). */
export async function dispatchFixIssue(slug: string, issueNumber: number): Promise<void> {
  const { runFixIssueWorkflow } = (await import(
    new URL('../../../../slices/fix-issue/workflow.js', import.meta.url).href
  )) as {
    runFixIssueWorkflow: (
      item: unknown,
      source: unknown,
      slug: string,
      repoRoot: string,
      deps?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  const source = await getSourceForSlug(slug);
  if (source == null) {
    logger.error('dispatchFixIssue: no source for slug', { slug });
    return;
  }
  const item = await source.getItem(issueNumber.toString());

  const mockDeps: Record<string, unknown> | undefined =
    process.env.MOCK_OPEN_PR === 'true'
      ? {
          openPRImpl: () =>
            Promise.resolve({
              prNumber: 999,
              prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
              branch: 'factory/mock-run',
              base: 'main',
            }),
          createWorktreeImpl: () => '/mock/worktree',
          cleanupWorktreeImpl: () => undefined,
          resolveWorktreeHeadShaImpl: () => 'mock-sha-abc123',
        }
      : undefined;

  await runFixIssueWorkflow(item, source, slug, REPO_ROOT, mockDeps);
}

/**
 * Webhook label-driven dispatcher. Routes the factory:* label to the right
 * workflow without requiring the webhook handler to know about the
 * `workflows` or `slices` directory layout.
 */
export async function dispatchForLabel(
  slug: string,
  issueNumber: number,
  labelName: string,
): Promise<void> {
  if (labelName === 'factory:triaging') {
    await dispatchTriageBatch(slug);
    return;
  }
  if (labelName === 'factory:investigating') {
    await dispatchInvestigate(slug, issueNumber);
    return;
  }
  if (labelName === 'factory:dev-ready') {
    await dispatchFixIssue(slug, issueNumber);
    return;
  }
  logger.info('dispatchForLabel: no workflow for label', { slug, labelName });
}
