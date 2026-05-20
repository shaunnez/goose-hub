import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import {
  type InterventionApplierDeps,
  startInterventionApplierWorker,
} from '@goose-hub/core/interventions/applier.js';
import { CACHE_KEY, bustCache } from '#shared/cache.js';
import { dispatchResolveConflict, dispatchResumeIssue } from '#shared/dispatch.js';
import { getSourceForSlug } from '#shared/source.js';
import { approveIssue, rejectIssue } from '../issues/service.js';

function issueNumberFromWorkItemId(workItemId: string): number {
  const raw = workItemId.match(/#(\d+)$/)?.[1] ?? workItemId;
  const issueNumber = Number(raw);
  if (!Number.isInteger(issueNumber)) {
    throw new Error(`invalid intervention workItemId: ${workItemId}`);
  }
  return issueNumber;
}

function interventionRef(input: { interventionId: string; correlationId: string }) {
  return { id: input.interventionId, correlationId: input.correlationId };
}

export function createServerInterventionApplierDeps(): InterventionApplierDeps {
  return {
    async transitionState(input) {
      const source = await getSourceForSlug(input.projectId);
      if (source == null) throw new Error(`project not found: ${input.projectId}`);
      const issueNumber = issueNumberFromWorkItemId(input.workItemId);
      const current = await source.getItem(String(issueNumber));
      if (current.state !== input.from) {
        throw new Error(
          `state changed before apply: expected ${input.from}, found ${current.state}`,
        );
      }
      await source.transitionState(
        input.workItemId,
        input.from,
        input.to,
        input.reason ?? 'operator intervention',
      );
      emitStateTransitionEvent({
        projectId: input.projectId,
        workItemId: input.workItemId,
        from: input.from,
        to: input.to,
        by: 'intervention-applier',
        extraPayload: {
          interventionId: input.interventionId,
          causedByInterventionId: input.interventionId,
          correlationId: input.correlationId,
        },
      });
      bustCache(CACHE_KEY.issues(input.projectId));
      return { ok: true, from: input.from, to: input.to };
    },

    async approveGate(input) {
      const issueNumber = issueNumberFromWorkItemId(input.workItemId);
      const result = await approveIssue(input.projectId, String(issueNumber), {
        intervention: interventionRef(input),
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },

    async rejectGate(input) {
      const issueNumber = issueNumberFromWorkItemId(input.workItemId);
      const result = await rejectIssue(input.projectId, String(issueNumber), input.reason, {
        intervention: interventionRef(input),
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },

    async resumeWorkflow(input) {
      const issueNumber = issueNumberFromWorkItemId(input.workItemId);
      await dispatchResumeIssue(input.projectId, issueNumber, {
        intervention: interventionRef(input),
      });
      return { ok: true, dispatched: 'resume_workflow' };
    },

    async resolveConflict(input) {
      const issueNumber = issueNumberFromWorkItemId(input.workItemId);
      await dispatchResolveConflict(input.projectId, issueNumber);
      return { ok: true, dispatched: 'resolve_conflict' };
    },
  };
}

export function startServerInterventionApplierWorker(): () => void {
  return startInterventionApplierWorker({
    deps: createServerInterventionApplierDeps(),
    leaseOwner: 'server-intervention-applier',
  });
}
