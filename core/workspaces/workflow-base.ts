import { eventStore } from '../event-stream/store.js';
import { type WorkflowBase, resolveWorkflowBase } from './worktree.js';

export type WorkflowBaseForWorkItemSource = WorkflowBase['source'] | 'dogfood-seed';

export type WorkflowBaseForWorkItem = Omit<WorkflowBase, 'source'> & {
  source: WorkflowBaseForWorkItemSource;
};

type DogfoodSeedAppliedPayload = {
  baseBranch?: unknown;
  baseRef?: unknown;
};

function payloadRecord(payload: unknown): DogfoodSeedAppliedPayload {
  return payload != null && typeof payload === 'object'
    ? (payload as DogfoodSeedAppliedPayload)
    : {};
}

export function resolveWorkflowBaseForWorkItem(
  projectId: string,
  workItemId: string,
  targetRepo: string,
  defaultBranch?: string,
): WorkflowBaseForWorkItem {
  const seedEvent = eventStore
    .replay({
      projectId,
      workItemId,
      kind: 'dogfood.seed-applied',
      order: 'desc',
      limit: 1,
    })
    .at(0);

  const payload = payloadRecord(seedEvent?.payload);
  if (typeof payload.baseBranch === 'string' && typeof payload.baseRef === 'string') {
    const branch = payload.baseBranch.trim();
    const ref = payload.baseRef.trim();
    if (branch.length > 0 && ref.length > 0) {
      return { branch, ref, source: 'dogfood-seed' };
    }
  }

  return resolveWorkflowBase(targetRepo, defaultBranch);
}
