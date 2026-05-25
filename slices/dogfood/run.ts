import { type AppendEventInput, eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  type AgentEventDto,
  type ChecklistProgress,
  TERMINAL_STATES,
  type WorkflowKind,
  newProgress,
  observeEvent,
  renderChecklist,
} from './checklist.js';
import { tailEvents } from './event-tail.js';
import { GhClient } from './gh-issue.js';
import { type Completion, newRun } from './outcome.js';
import {
  type DogfoodSeedGitOps,
  applySeed,
  defaultDogfoodSeedGitOps,
  restoreSeed,
  verifyGreen,
  verifyRed,
} from './runner.js';
import { RunsStore } from './runs-store.js';
import { getSeed } from './seeds/index.js';
import type { Seed } from './seeds/types.js';

export interface RunOrchestratorOptions {
  seedId: string;
  /** Repo root used for apply/restore/verify. */
  repoRoot: string;
  /** Workflow kind. Currently every seed runs `bug`; future seeds may pick others. */
  workflow?: WorkflowKind;
  /** Server URL hosting the SSE endpoint. */
  serverUrl?: string;
  /** GitHub repo to file the issue on. */
  repo?: string;
  /** Project slug used by the orchestrator. */
  projectSlug?: string;
  /** Cap on event-tail wall-clock time. */
  timeoutMs?: number;
  /** Restore the seed when finished, regardless of outcome. */
  restoreOnFinish?: boolean;
  /** Delete the pushed dogfood seed branch after the run completes. */
  deleteRemoteBranchOnFinish?: boolean;
  /** Skip the local verify-red sanity check (use in CI dry-runs). */
  skipVerifyRed?: boolean;
  /** Skip the final truth-signal green check. */
  skipVerifyGreen?: boolean;
  /** Injected GhClient (for tests). */
  gh?: GhClient;
  /** Injected RunsStore (for tests). */
  store?: RunsStore;
  /** Injected event-tail (for tests). */
  tail?: typeof tailEvents;
  /** Injected git operations (for tests). */
  seedGit?: DogfoodSeedGitOps;
  /** Injected durable event writer (for tests). */
  appendEvent?: (input: AppendEventInput) => unknown | Promise<unknown>;
  /** Console-like sink. */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface RunOrchestratorResult {
  runId: string;
  seed: Seed;
  issue: { repo: string; number: number; url: string };
  completion: Completion;
  progress: ChecklistProgress;
  reason: 'callback-stopped' | 'timeout' | 'aborted' | 'server-closed';
}

const DEFAULTS = {
  serverUrl: 'http://localhost:3001',
  repo: 'shaunnez/goose-hub',
  projectSlug: 'goose-hub-self',
  workflow: 'bug' as WorkflowKind,
  timeoutMs: 30 * 60 * 1000, // 30 minutes
};

/**
 * End-to-end dogfood orchestrator:
 * 1. Apply seed locally + verify-red sanity check
 * 2. File the GitHub issue via gh
 * 3. Record a pending run row pointing at the issue
 * 4. Tail the SSE event stream, ticking off the workflow's expected
 *    state-transitions and stopping when terminal or a node fails
 * 5. Record outcome (completion at minimum; truth-pass left for follow-up)
 *
 * Intended to be run on the user's local machine where the server is
 * up + agents are authenticated. Each phase is dependency-injected so
 * unit tests can exercise the orchestration without real network/gh.
 */
export async function runDogfood(opts: RunOrchestratorOptions): Promise<RunOrchestratorResult> {
  const cfg = {
    serverUrl: opts.serverUrl ?? DEFAULTS.serverUrl,
    repo: opts.repo ?? DEFAULTS.repo,
    projectSlug: opts.projectSlug ?? DEFAULTS.projectSlug,
    workflow: opts.workflow ?? DEFAULTS.workflow,
    timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
  };
  const log = opts.logger ?? console;
  const gh = opts.gh ?? new GhClient();
  const store = opts.store ?? new RunsStore();
  const tail = opts.tail ?? tailEvents;
  const seedGit = opts.seedGit ?? defaultDogfoodSeedGitOps;
  const appendEvent =
    opts.appendEvent ?? ((event: AppendEventInput) => eventStore.appendEvent(event));
  const seed = getSeed(opts.seedId);
  const run = newRun(seed.id, cfg.workflow);
  const seedBranch = `dogfood/${run.runId}/${seed.id}`;

  log.log('[1/5] pre-flight — gh auth + seed');
  await gh.assertReady();
  await seedGit.assertClean(opts.repoRoot);
  const originalRef = await seedGit.currentRef(opts.repoRoot);

  log.log(`[2/5] create seed branch + apply seed: ${seed.id}`);
  await seedGit.createBranch(opts.repoRoot, seedBranch);
  let seedCommit: string | undefined;
  let issue: { number: number; url: string } | undefined;
  let completion: Completion = 'pending';
  const progress = newProgress(cfg.workflow);
  let tailReason: RunOrchestratorResult['reason'] = 'aborted';
  let eventCount = 0;
  let seedApplied = false;
  try {
    await applySeed(seed.id, { repoRoot: opts.repoRoot });
    seedApplied = true;
    if (!opts.skipVerifyRed) {
      const result = await verifyRed(seed.id, { repoRoot: opts.repoRoot });
      if (!result.truthSignalRed) {
        throw new Error(
          `verify-red failed: truth-signal "${seed.truthSignal.testName}" was NOT red after applying ${seed.id}. Seed likely needs an update.`,
        );
      }
      if (result.unexpectedFailures.length > 0) {
        throw new Error(
          `verify-red failed: ${result.unexpectedFailures.length} unrelated tests failed in ${seed.truthSignal.testFile}. Fix those before running.`,
        );
      }
      log.log(`      truth-signal red, ${result.passingTests.length} siblings green`);
    }
    seedCommit = await seedGit.commitAll(opts.repoRoot, `dogfood: seed ${seed.id}`);
    await seedGit.pushBranch(opts.repoRoot, seedBranch);
    log.log(`      baseBranch: ${seedBranch}`);
    log.log(`      seedCommit: ${seedCommit}`);

    log.log(`[3/5] file GitHub issue on ${cfg.repo}`);
    issue = await gh.createIssue({
      repo: cfg.repo,
      title: seed.issue.title,
      body: seed.issue.body,
      labels: seed.issue.labels,
    });
    const workItemId = `github:${cfg.repo}#${issue.number}`;
    log.log(`      issue #${issue.number}: ${issue.url}`);
    log.log(`      workItemId: ${workItemId}`);

    run.issue = { repo: cfg.repo, number: issue.number, url: issue.url };
    run.baseBranch = seedBranch;
    run.baseRef = seedCommit;
    run.seedCommit = seedCommit;
    await store.append(run);
    await appendEvent({
      projectId: cfg.projectSlug,
      workItemId,
      kind: 'dogfood.seed-applied',
      payload: {
        seedId: seed.id,
        baseBranch: seedBranch,
        baseRef: seedCommit,
        seedCommit,
        truthSignal: seed.truthSignal,
      },
      runId: run.runId,
    });
    log.log(`      runId: ${run.runId}`);

    log.log(`[4/5] tailing event stream (timeout ${cfg.timeoutMs}ms)`);
    printChecklist(log, progress);

    const tailResult = await tail(
      {
        serverUrl: cfg.serverUrl,
        projectId: cfg.projectSlug,
        workItemId,
        timeoutMs: cfg.timeoutMs,
      },
      (event: AgentEventDto) => {
        const advanced = observeEvent(progress, event);
        if (advanced) {
          log.log('');
          printChecklist(log, progress);
          if (progress.failedNode)
            log.log(`      [!] agent failure at node: ${progress.failedNode}`);
        }
        if (progress.terminalReached) return true;
        if (progress.failedNode) return true;
        return false;
      },
    );
    tailReason = tailResult.reason;
    eventCount = tailResult.events.length;

    log.log(`[5/5] tail ended (${tailResult.reason}); recording outcome`);
    completion = computeCompletion(progress, tailResult.reason);
    await store.update(run.runId, {
      completion,
      endedAt: new Date().toISOString(),
    });

    if (
      opts.skipVerifyGreen !== true &&
      opts.restoreOnFinish !== false &&
      progress.terminalReached
    ) {
      const truthPass = await verifyTruthSignalAgainstFinalCode({
        repoRoot: opts.repoRoot,
        seedId: seed.id,
        seedGit,
        events: tailResult.events,
      }).catch((err) => {
        log.warn(
          `      truth-pass check skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      });
      if (truthPass != null) {
        await store.update(run.runId, { truthPass });
        log.log(`      truth-pass: ${truthPass}`);
      }
    }
  } finally {
    if (opts.restoreOnFinish !== false) {
      log.log('      restoring operator branch');
      if (seedApplied && seedCommit == null) {
        await restoreSeed(seed.id, { repoRoot: opts.repoRoot }).catch((err) => {
          log.warn(
            `      uncommitted seed restore failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
      await seedGit.checkout(opts.repoRoot, originalRef).catch((err) => {
        log.warn(
          `      checkout restore failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      await seedGit.deleteLocalBranch(opts.repoRoot, seedBranch).catch((err) => {
        log.warn(
          `      local branch cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      if (opts.deleteRemoteBranchOnFinish === true && seedGit.deleteRemoteBranch != null) {
        await seedGit.deleteRemoteBranch(opts.repoRoot, seedBranch).catch((err) => {
          log.warn(
            `      remote branch cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }
  }

  log.log('');
  log.log('Summary:');
  log.log(`  runId:      ${run.runId}`);
  log.log(`  issue:      ${issue?.url ?? '<not filed>'}`);
  log.log(`  workItemId: ${issue == null ? '<not filed>' : `github:${cfg.repo}#${issue.number}`}`);
  log.log(`  baseBranch: ${seedBranch}`);
  log.log(`  seedCommit: ${seedCommit ?? '<not committed>'}`);
  log.log(
    `  completion: ${typeof completion === 'string' ? completion : `failed:${completion.failed.node}`}`,
  );
  log.log(`  events:     ${eventCount}`);
  log.log('');
  log.log('Once you know the real outcome, record the remaining signals:');
  log.log(
    `  pnpm dogfood record ${run.runId} --truth-pass=<true|false> --qa-correct=<true|false> --hygiene-clean=<true|false>`,
  );

  if (issue == null) {
    throw new Error('dogfood issue was not filed');
  }

  return {
    runId: run.runId,
    seed,
    issue: { repo: cfg.repo, number: issue.number, url: issue.url },
    completion,
    progress,
    reason: tailReason,
  };
}

async function verifyTruthSignalAgainstFinalCode(input: {
  repoRoot: string;
  seedId: string;
  seedGit: DogfoodSeedGitOps;
  events: AgentEventDto[];
}): Promise<boolean | undefined> {
  const prOpened = [...input.events].reverse().find((event) => event.kind === 'pr.opened');
  const payload = prOpened?.payload as { branch?: unknown } | undefined;
  const branch = typeof payload?.branch === 'string' ? payload.branch : undefined;
  if (branch == null || branch.trim().length === 0) return undefined;

  await input.seedGit.fetchBranch(input.repoRoot, branch);
  await input.seedGit.checkout(input.repoRoot, `origin/${branch}`);
  return verifyGreen(input.seedId, { repoRoot: input.repoRoot });
}

function printChecklist(
  log: Pick<Console, 'log' | 'warn' | 'error'>,
  progress: ChecklistProgress,
): void {
  log.log(`  workflow=${progress.workflow}`);
  log.log(renderChecklist(progress));
}

export function computeCompletion(
  progress: ChecklistProgress,
  reason: 'callback-stopped' | 'timeout' | 'aborted' | 'server-closed',
): Completion {
  if (progress.failedNode) {
    return { failed: { node: progress.failedNode, reason: reason } };
  }
  if (progress.terminalReached) return 'reached-terminal';
  if (reason === 'timeout') return 'stalled';
  if (reason === 'aborted') return 'aborted-by-human';
  return 'stalled';
}

export const __test_only = { DEFAULTS, computeCompletion, TERMINAL_STATES };
