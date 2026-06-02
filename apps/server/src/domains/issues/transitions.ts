import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { checkAndClearMergeConflict } from '@goose-hub/core/agent-runtime/mock-test-registry.js';
import {
  MergeConflictError,
  mergePR as defaultMergePR,
} from '@goose-hub/core/connectors/github/merge-pr.js';
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { upsertGithubExternalRef } from '@goose-hub/core/integrations/github/external-refs.js';
import { validateInterventionAction } from '@goose-hub/core/interventions/actions.js';
import {
  decide,
  markApplying,
  open,
  recordApplicationResult,
  resolve,
  supersede,
  verify,
} from '@goose-hub/core/interventions/reducer.js';
import { listInterventions } from '@goose-hub/core/interventions/repository.js';
import { ACTIVE_INTERVENTION_STATUSES } from '@goose-hub/core/interventions/types.js';
import { logger } from '@goose-hub/core/logger.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { STATES, TERMINAL_STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import { activeDiscoverSessionId } from '@goose-hub/core/workflows/grill-and-prd/discover-session.js';
import { cleanupWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { CACHE_KEY, bustCache } from '#shared/cache.js';
import { dispatchRetro } from '#shared/dispatch.js';
import type { Result } from '#shared/middleware.js';
import { sliceUrl } from '#shared/slice-url.js';
import { resolveWorkItemForRoute } from '#shared/work-item-resolution.js';
import { maybeFireSprintReview } from '../workflows/sprint-review-trigger.js';

// Slice imports cross the package boundary (FACTORY_RULES rule 28a — slices/
// is not a workspace package). Use dynamic import via import.meta.url so the
// resolution works regardless of cwd.
type MergeDecisionResult =
  | { passed: true; score: number; reason: 'score-only-pass' | 'score-plus-convergence-pass' }
  | {
      passed: false;
      score: number;
      reason: 'score-below-threshold' | 'not-converged';
      detail: string;
    };

type RunMergeDecisionFn = (input: {
  pipelineRunId: string;
  projectId: string;
  workItemId?: string | null;
  runId?: string;
  iteration?: number;
}) => MergeDecisionResult;

const INTERVENTION_BACKED_STATES: ReadonlySet<StateName> = new Set([
  'factory:needs-human',
  'factory:gate-pending',
  'factory:merge-conflict',
]);

function shouldSupersedeActiveInterventions(from: StateName, to: StateName): boolean {
  return TERMINAL_STATES.has(to) || INTERVENTION_BACKED_STATES.has(from);
}

function supersedeOtherActiveInterventions(input: {
  projectId: string;
  workItemId: string;
  supersededBy: string;
  actor: string;
}): void {
  for (const intervention of listInterventions({
    projectId: input.projectId,
    workItemId: input.workItemId,
    status: [...ACTIVE_INTERVENTION_STATUSES],
    limit: 500,
  })) {
    if (intervention.id === input.supersededBy) continue;
    const result = supersede({
      id: intervention.id,
      expectedVersion: intervention.version,
      supersededBy: input.supersededBy,
      actor: input.actor,
    });
    if (!result.ok) {
      logger.warn('failed to supersede stale intervention after manual transition', {
        interventionId: intervention.id,
        workItemId: input.workItemId,
        error: result.error,
      });
    }
  }
}

function maybeFireSprintReviewForTerminalTransition(input: {
  slug: string;
  item: { milestoneId?: string; milestoneTitle?: string };
  source: Parameters<typeof maybeFireSprintReview>[3];
}): void {
  const milestoneNumber = input.item.milestoneId != null ? Number(input.item.milestoneId) : null;
  const milestoneTitle = input.item.milestoneTitle ?? null;
  if (milestoneNumber == null || Number.isNaN(milestoneNumber) || milestoneTitle == null) return;
  void maybeFireSprintReview(input.slug, milestoneNumber, milestoneTitle, input.source);
}

async function loadMergeDecision(): Promise<RunMergeDecisionFn> {
  const mod = (await import(sliceUrl('merge-decision'))) as {
    runMergeDecision: RunMergeDecisionFn;
  };
  return mod.runMergeDecision;
}

export type TransitionResult =
  | { ok: true; data: { ok: true; from: StateName; to: StateName } }
  | { ok: false; error: string; status: number; legalTargets?: readonly StateName[] };

/**
 * Approve gate (#186). Looks up the most recent `pr.opened` event for the
 * issue, merges that PR via the GitHub connector, emits `gate.approved` +
 * `pr.merged` events, and transitions factory:approved → factory:retrospecting.
 *
 * Optional `mergePRImpl` is dependency-injected so tests can stub the
 * REST call.
 */
export async function approveIssue(
  slug: string,
  id: string,
  options: {
    mergePRImpl?: typeof defaultMergePR;
    runMergeDecisionImpl?: RunMergeDecisionFn;
    pipelineEnabledOverride?: boolean;
    intervention?: { id: string; correlationId: string };
  } = {},
): Promise<Result<{ ok: true; sha: string; prNumber: number }>> {
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId, repoRef } = resolved.data;

  // Find the most recent pr.opened event for this issue.
  const events = eventStore.replay({ projectId: slug, workItemId });
  const prEvent = [...events].reverse().find((e) => e.kind === 'pr.opened');
  if (prEvent == null) {
    return {
      ok: false,
      error: 'no pr.opened event found — cannot approve without a PR',
      status: 400,
    };
  }
  const prPayload = prEvent.payload as { prNumber?: number; pipelineRunId?: string };
  const prNumber = prPayload.prNumber;
  if (typeof prNumber !== 'number') {
    return { ok: false, error: 'pr.opened event missing prNumber', status: 500 };
  }
  const pipelineRunId =
    typeof prPayload.pipelineRunId === 'string' ? prPayload.pipelineRunId : undefined;

  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0 && process.env.MOCK_SOURCE !== 'true') {
    return { ok: false, error: 'GITHUB_TOKEN env var not set', status: 500 };
  }

  const mergePR = options.mergePRImpl ?? defaultMergePR;

  // ─── Merge-decision gate (M19.21 #697) ──────────────────────────────────────
  // When the multi-agent pipeline is enabled and the PR carries a
  // pipelineRunId, run the deterministic quality-score gate BEFORE mergePR.
  // Pass → proceed to merge. Fail → skip merge, transition to needs-human.
  // Human escape hatch: merging directly via the GitHub UI bypasses this gate
  // entirely (we only run it inside the Goose Hub approve action).
  const projectCfg = await getProjectBySlug(slug);
  const pipelineEnabled =
    options.pipelineEnabledOverride ??
    (projectCfg != null ? getUseMultiAgentPipeline(projectCfg.id) : false);

  if (pipelineEnabled && pipelineRunId != null) {
    let decision: MergeDecisionResult;
    try {
      const runMergeDecisionFn = options.runMergeDecisionImpl ?? (await loadMergeDecision());
      decision = runMergeDecisionFn({
        pipelineRunId,
        // Use the slug — that's the same key all qa.completed/review.completed
        // events are written with, so buildRunArtifacts can find them. Falls
        // back gracefully if a project ever has id !== slug.
        projectId: slug,
        workItemId,
      });
    } catch (err) {
      logger.error('merge-decision gate failed', { slug, id, error: String(err) });
      // Treat a gate runtime error as an explicit fail — never silently merge.
      decision = {
        passed: false,
        score: 0,
        reason: 'score-below-threshold',
        detail: `merge-decision gate threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge-decision.completed',
      payload: {
        ...decision,
        pipelineRunId,
        prNumber,
        ...interventionEventPayload(options.intervention),
      },
    });

    if (!decision.passed) {
      await source.comment(
        id,
        buildAgentComment('Merge gate', 'Blocked', `Auto-merge gate blocked: ${decision.reason}`, [
          `Score: ${decision.score}`,
          decision.detail,
        ]),
      );
      await transitionAndEmitState({
        mode: 'legal',
        source,
        itemId: id,
        projectId: slug,
        workItemId,
        from: 'factory:approved',
        to: 'factory:needs-human',
        by: 'merge-decision',
        extraPayload: interventionEventPayload(options.intervention),
      });
      return {
        ok: false,
        error: `merge-decision blocked: ${decision.reason}`,
        status: 409,
      };
    }
  }

  if (process.env.MOCK_SOURCE === 'true' && checkAndClearMergeConflict(workItemId)) {
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge.conflict',
      payload: { prNumber, ...interventionEventPayload(options.intervention) },
    });
    await transitionAndEmitState({
      mode: 'legal',
      source,
      itemId: id,
      projectId: slug,
      workItemId,
      from: 'factory:approved',
      to: 'factory:merge-conflict',
      by: 'orchestrator',
      extraPayload: interventionEventPayload(options.intervention),
    });
    return { ok: false, error: 'merge-conflict', status: 409 };
  }

  let merged: { sha: string; merged: boolean };
  try {
    merged = await mergePR({ repo: repoRef, prNumber, token });
  } catch (err) {
    if (err instanceof MergeConflictError) {
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'merge.conflict',
        payload: { prNumber, ...interventionEventPayload(options.intervention) },
      });
      await transitionAndEmitState({
        mode: 'legal',
        source,
        itemId: id,
        projectId: slug,
        workItemId,
        from: 'factory:approved',
        to: 'factory:merge-conflict',
        by: 'orchestrator',
        extraPayload: interventionEventPayload(options.intervention),
      });
      return { ok: false, error: 'merge-conflict', status: 409 };
    }
    throw err;
  }

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'gate.approved',
    payload: { source: 'ui', prNumber, ...interventionEventPayload(options.intervention) },
  });
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'pr.merged',
    payload: { prNumber, sha: merged.sha, ...interventionEventPayload(options.intervention) },
  });
  if (workItemId.startsWith('local:')) {
    upsertGithubExternalRef({
      projectId: slug,
      workItemId,
      kind: 'commit',
      repoRef,
      externalId: merged.sha,
    });
  }

  // Clean up the dev worktree now that the PR is merged.
  const allEvents = eventStore.replay({ workItemId });
  const prOpenedEvent = allEvents
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpenedEvent != null) {
    const { devRunId } = prOpenedEvent.payload as { devRunId?: string };
    if (typeof devRunId === 'string') cleanupWorktree(devRunId);
  }

  await transitionAndEmitState({
    mode: 'legal',
    source,
    itemId: workItemId,
    projectId: slug,
    workItemId,
    from: 'factory:approved',
    to: 'factory:retrospecting',
    by: 'ui',
    extraPayload: interventionEventPayload(options.intervention),
  });
  await source.comment(
    workItemId,
    buildAgentComment('Gate', 'Approved', `PR #${prNumber} merged via Goose Hub UI`, [
      `SHA: ${merged.sha}`,
    ]),
  );

  // Fire-and-forget the retrospective. The label-change webhook will also
  // dispatch retro on factory:retrospecting; running it here avoids waiting
  // on webhook delivery. Sequential duplicates no-op via the state check in
  // dispatchRetro (state advances past factory:retrospecting once the
  // workflow finishes); concurrent duplicates no-op via _issueInFlight.
  dispatchRetro(slug, Number(id)).catch((err: unknown) => {
    logger.error('dispatchRetro after approve failed', { slug, id, error: String(err) });
  });

  return { ok: true, data: { ok: true, sha: merged.sha, prNumber } };
}

/**
 * Reject gate (#186). Records a rejection note as a GitHub comment, emits
 * `gate.rejected`, and transitions factory:approved → factory:needs-fix.
 * Does NOT touch the PR (humans handle PR closure manually if needed).
 */
export async function rejectIssue(
  slug: string,
  id: string,
  reason: unknown,
  options: { intervention?: { id: string; correlationId: string } } = {},
): Promise<Result<{ ok: true }>> {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, error: 'rejection reason is required', status: 400 };
  }
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId } = resolved.data;

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'gate.rejected',
    payload: { source: 'ui', reason, ...interventionEventPayload(options.intervention) },
  });
  await source.comment(
    workItemId,
    buildAgentComment('Gate', 'Rejected', 'Rejected at approval gate', [`Reason: ${reason}`]),
  );
  await transitionAndEmitState({
    mode: 'legal',
    source,
    itemId: workItemId,
    projectId: slug,
    workItemId,
    from: 'factory:approved',
    to: 'factory:needs-fix',
    by: 'ui',
    extraPayload: interventionEventPayload(options.intervention),
  });

  return { ok: true, data: { ok: true } };
}

function interventionEventPayload(
  intervention: { id: string; correlationId: string } | undefined,
): Record<string, string> {
  if (intervention == null) return {};
  return {
    interventionId: intervention.id,
    causedByInterventionId: intervention.id,
    correlationId: intervention.correlationId,
  };
}

export async function transitionIssue(
  slug: string,
  id: string,
  from: unknown,
  to: unknown,
): Promise<TransitionResult> {
  if (from == null || to == null) {
    return { ok: false, error: "missing 'from' or 'to'", status: 400 };
  }
  if (!(STATES as readonly string[]).includes(from as string)) {
    return { ok: false, error: `invalid state name for 'from': ${from}`, status: 400 };
  }
  if (!(STATES as readonly string[]).includes(to as string)) {
    return { ok: false, error: `invalid state name for 'to': ${to}`, status: 400 };
  }

  const fromState = from as StateName;
  const toState = to as StateName;

  if (!isLegalTransition(fromState, toState)) {
    return {
      ok: false,
      error: 'illegal transition',
      status: 422,
      legalTargets: legalTargets(fromState),
    };
  }

  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, item, canonicalWorkItemId: workItemId } = resolved.data;
  const discoverSessionId =
    fromState === 'factory:gate-pending' && toState === 'factory:grilling'
      ? activeDiscoverSessionId(slug, workItemId)
      : null;
  const sessionPayload =
    discoverSessionId != null ? { discoverSessionId } : ({} as Record<string, never>);
  const manual = open({
    projectId: slug,
    workItemId,
    interventionType: 'manual_override',
    title: 'Manual operator transition',
    reason: `Operator requested ${fromState} -> ${toState}`,
    rootCauseSignature: `manual_override|${slug}|${workItemId}|${fromState}|${toState}|${Date.now()}`,
    actor: 'ui',
    evidence: { from: fromState, to: toState, ...sessionPayload },
  });
  if (!manual.ok) return { ok: false, error: manual.error, status: manual.status };

  const payload = {
    from: fromState,
    to: toState,
    reason: 'manual operator transition',
    ...sessionPayload,
  };
  const validation = validateInterventionAction('manual_transition', payload);
  if (!validation.ok) return { ok: false, error: validation.error, status: 422 };

  const decided = decide({
    id: manual.intervention.id,
    expectedVersion: manual.intervention.version,
    actionType: 'manual_transition',
    actionPayload: payload,
    decidedBy: 'ui',
    reason: payload.reason,
  });
  if (!decided.ok) return { ok: false, error: decided.error, status: decided.status };

  const applying = markApplying({
    id: manual.intervention.id,
    expectedVersion: decided.intervention.version,
    leaseOwner: 'ui',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  if (!applying.ok) return { ok: false, error: applying.error, status: applying.status };

  try {
    await transitionAndEmitState({
      mode: 'legal',
      source,
      itemId: workItemId,
      projectId: slug,
      workItemId,
      from: fromState,
      to: toState,
      by: 'ui',
      extraPayload: {
        interventionId: manual.intervention.id,
        causedByInterventionId: manual.intervention.id,
        correlationId: manual.intervention.correlationId,
        ...sessionPayload,
      },
    });
  } catch (err) {
    recordApplicationResult({
      id: manual.intervention.id,
      expectedVersion: applying.intervention.version,
      ok: false,
      result: { error: err instanceof Error ? err.message : String(err) },
      actor: 'ui',
    });
    throw err;
  }

  const applied = recordApplicationResult({
    id: manual.intervention.id,
    expectedVersion: applying.intervention.version,
    ok: true,
    result: { from: fromState, to: toState, ...sessionPayload },
    actor: 'ui',
  });
  let manualResolved = false;
  if (applied.ok) {
    const verified = verify({
      id: manual.intervention.id,
      expectedVersion: applied.intervention.version,
      verification: { stateTransitionEmitted: true },
      actor: 'ui',
    });
    if (verified.ok) {
      const resolved = resolve({
        id: manual.intervention.id,
        expectedVersion: verified.intervention.version,
        reason: 'manual transition applied',
        actor: 'ui',
      });
      manualResolved = resolved.ok;
    }
  }
  if (manualResolved && shouldSupersedeActiveInterventions(fromState, toState)) {
    supersedeOtherActiveInterventions({
      projectId: slug,
      workItemId,
      supersededBy: manual.intervention.id,
      actor: 'ui',
    });
  }
  if (TERMINAL_STATES.has(toState)) {
    maybeFireSprintReviewForTerminalTransition({ slug, item, source });
  }

  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true, from: fromState, to: toState } };
}
