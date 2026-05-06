import { logger } from '../logger.js';
import { parseDependencies } from '../state-source/dependency-parser.js';
import {
  DependencyResolver,
  type FetchTargetFn,
  type ResolvedDep,
} from '../state-source/dependency-resolver.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';

export type DepSatisfactionState = 'satisfied' | 'blocked' | 'unregistered';

export interface DependencyEvaluation {
  state: DepSatisfactionState;
  resolved: ResolvedDep[];
  blockingDeps: ResolvedDep[];
  unregisteredDeps: ResolvedDep[];
}

/**
 * Resolve all dependency refs in an item's body and classify the result.
 *
 * Classification rules (in priority order):
 *  - unregistered: any dep whose repo is not registered → whole item is unregistered
 *  - blocked: any open dep → item is blocked
 *  - satisfied: zero deps, or all deps closed
 *
 * Uses a shared `DependencyResolver` so callers can batch many items in one
 * tick and benefit from the resolver's per-instance cache.
 */
export async function evaluateDependencies(
  item: WorkItem,
  resolver: DependencyResolver,
): Promise<DependencyEvaluation> {
  // Only 'depends-on' refs gate the current item. 'blocks' refs mean the
  // current issue is the blocker for another issue — resolving them here would
  // invert dependency semantics and prevent the blocking issue from dispatching.
  const refs = parseDependencies(item.body).filter((r) => r.type === 'depends-on');
  if (refs.length === 0) {
    return { state: 'satisfied', resolved: [], blockingDeps: [], unregisteredDeps: [] };
  }

  const resolved = await Promise.all(refs.map((ref) => resolver.resolve(ref)));
  const unregisteredDeps = resolved.filter((r) => r.state === 'unregistered');
  const blockingDeps = resolved.filter((r) => r.state === 'open');

  let state: DepSatisfactionState;
  if (unregisteredDeps.length > 0) {
    state = 'unregistered';
  } else if (blockingDeps.length > 0) {
    state = 'blocked';
  } else {
    state = 'satisfied';
  }

  return { state, resolved, blockingDeps, unregisteredDeps };
}

export interface SchedulerContext {
  currentRepo: string;
  fetchTarget: FetchTargetFn;
  source: StateSource;
}

export interface SchedulerFilterResult {
  eligible: WorkItem[];
  blocked: WorkItem[];
  unregistered: WorkItem[];
}

/**
 * Filter a list of work items by dependency satisfaction.
 *
 * A fresh `DependencyResolver` is created per call (= per tick), so results
 * are never cached across ticks — deps that close mid-sprint are picked up on
 * the next invocation.
 *
 * Side-effects on the source:
 *  - blocked items that weren't already `schedule:blocked-by` get that label applied
 *  - previously-blocked items that are now satisfied have `schedule:current` restored
 *  - unregistered items: no label change (M11.07 handles the needs-human escalation)
 *
 * Returns three partitions: eligible (dispatch normally), blocked (label applied,
 * skip this tick), unregistered (skip; M11.07 escalates separately).
 */
export async function filterEligibleByDependencies(
  items: WorkItem[],
  ctx: SchedulerContext,
): Promise<SchedulerFilterResult> {
  const resolver = new DependencyResolver({
    currentRepo: ctx.currentRepo,
    fetchTarget: ctx.fetchTarget,
  });

  const eligible: WorkItem[] = [];
  const blocked: WorkItem[] = [];
  const unregistered: WorkItem[] = [];

  await Promise.all(
    items.map(async (item) => {
      const evaluation = await evaluateDependencies(item, resolver);

      if (evaluation.state === 'satisfied') {
        if (item.schedule === 'blocked-by') {
          await ctx.source.setLabelInGroup(item.externalId, 'schedule', 'current');
          logger.info('dep-scheduler: deps satisfied, restored schedule:current', {
            externalId: item.externalId,
          });
        }
        eligible.push(item);
      } else if (evaluation.state === 'blocked') {
        if (item.schedule !== 'blocked-by') {
          await ctx.source.setLabelInGroup(item.externalId, 'schedule', 'blocked-by');
          logger.info('dep-scheduler: open deps, applied schedule:blocked-by', {
            externalId: item.externalId,
            blockingDeps: evaluation.blockingDeps.map((d) => `${d.repoRef}#${d.issueNumber}`),
          });
        }
        blocked.push(item);
      } else {
        // unregistered — escalate to factory:needs-human on first encounter
        if (item.state !== 'factory:needs-human') {
          const depList = evaluation.unregisteredDeps
            .map((d) => `\`${d.repoRef}#${d.issueNumber}\``)
            .join(', ');
          const commentBody = `Dependency on ${depList} cannot be resolved — repo is not registered. Register the repo or remove the dependency to unblock.`;
          await ctx.source.forceState(item.externalId, 'factory:needs-human');
          await ctx.source.comment(item.externalId, commentBody);
          logger.info('dep-scheduler: unregistered dep escalated to factory:needs-human', {
            externalId: item.externalId,
            unregisteredDeps: evaluation.unregisteredDeps.map(
              (d) => `${d.repoRef}#${d.issueNumber}`,
            ),
          });
        } else {
          logger.info('dep-scheduler: unregistered dep already escalated, skipping', {
            externalId: item.externalId,
          });
        }
        unregistered.push(item);
      }
    }),
  );

  return { eligible, blocked, unregistered };
}
