// slices/review/review-audit.ts
import { runCodeQualityAudit } from '@goose-hub/core/audit/run-audit.js';
import { db } from '@goose-hub/core/db/db.js';
import { improvementCandidates as improvementCandidatesTable } from '@goose-hub/core/db/schema.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { existingWorktreePath } from '@goose-hub/core/workspaces/worktree.js';

type ReviewAuditOutcome = {
  ran: boolean;
  autonomyGateFired: boolean;
  auditScore?: number;
  summaryDetail?: string;
};

type SettledAudit = Awaited<ReturnType<typeof runCodeQualityAudit>> | { ok: false; error: string };

type StartedAudit =
  | { ran: false }
  | {
      ran: true;
      pipelineRunId: string;
      /** Eagerly-attached `.catch` keeps the rejection observed even when
       * an early-exit path (escalation, divergence, cap) returns before
       * the convergent gate awaits it. */
      promise: Promise<SettledAudit>;
    };

export function findDevRunId(events: { kind: string; payload: unknown }[]): string | undefined {
  for (const e of [...events].reverse()) {
    if (e.kind !== 'pr.opened') continue;
    const p = e.payload as { devRunId?: string } | null;
    if (p?.devRunId != null && typeof p.devRunId === 'string') return p.devRunId;
  }
  return undefined;
}

/** Parse a state-source externalId to a number for the audit context. Not
 * every tracker uses numeric IDs — e.g. Jira's `PROJ-123`. Returns undefined
 * when the ID is non-numeric so the caller can skip the audit cleanly
 * rather than send NaN through the Zod context schema. */
export function externalIdAsNumber(externalId: string): number | undefined {
  if (!/^\d+$/.test(externalId)) return undefined;
  const n = Number.parseInt(externalId, 10);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function startConvergentReviewAudit(input: {
  workItem: WorkItem;
  projectSlug: string;
  pipelineRunId?: string;
  mode: 'interactive' | 'supervised' | 'autonomous';
}): StartedAudit {
  const isHighPriority =
    input.workItem.priority === 'high' || input.workItem.priority === 'critical';
  if (!isHighPriority) return { ran: false };

  // Locate a worktree to audit. The dev worktree from implementation should
  // still exist at review time (cleanupWorktree fires post-merge). If the
  // dev worktree is gone (e.g. orphaned PR, manual replay) we skip the audit
  // rather than fabricate a synthetic path.
  const events = eventStore.replay({
    projectId: input.projectSlug,
    workItemId: input.workItem.id,
  });
  const devRunId = findDevRunId(events);
  if (devRunId == null) return { ran: false };

  const worktreePath = existingWorktreePath(devRunId);
  if (worktreePath == null) return { ran: false };

  const issueNumber = externalIdAsNumber(input.workItem.externalId);
  if (issueNumber == null) return { ran: false };

  const pipelineRunId = input.pipelineRunId ?? `review-${input.workItem.id}-${devRunId}`;
  const rawPromise = runCodeQualityAudit({
    projectId: input.projectSlug,
    workItemId: input.workItem.id,
    worktreePath,
    pipelineRunId,
    workItem: { title: input.workItem.title, number: issueNumber },
    trigger: 'convergent-review',
    mode: input.mode,
  });

  // Attach a catch immediately so an unawaited rejection (early review-exit
  // path) cannot bubble as an unhandled rejection.
  const promise = rawPromise.catch<SettledAudit>(
    (err: unknown): SettledAudit => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return { ran: true, pipelineRunId, promise };
}

export async function finalizeConvergentReviewAudit(
  started: StartedAudit,
  ctx: { projectSlug: string; workItem: WorkItem },
): Promise<ReviewAuditOutcome> {
  if (!started.ran) return { ran: false, autonomyGateFired: false };

  const result = await started.promise;

  if (!result.ok) return { ran: true, autonomyGateFired: false };

  // Persist top-3 ImprovementCandidates to the database. The retro path
  // re-uses `core/workflows/retrospective.ts#persistCandidates`; here we
  // open a small inline persister because review and retro live in
  // different packages.
  for (const c of result.improvementCandidates) {
    db.insert(improvementCandidatesTable)
      .values({
        projectId: ctx.projectSlug,
        personaName: c.sourcePersonaId ?? `${ctx.projectSlug}/auditor/0`,
        sourceTaskId: ctx.workItem.id,
        suggestionText: c.suggestionText,
        suggestionType: c.kind,
      })
      .run();
  }

  return {
    ran: true,
    autonomyGateFired: result.autonomyGateFired,
    auditScore: result.auditScore,
    summaryDetail: `Rating: ${result.output.rating}. Top recommendation: ${
      result.output.recommendations[0]?.fix ?? '(none)'
    }`,
  };
}
