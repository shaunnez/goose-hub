import type { WorkItem } from '../state-source/interface.js';
import type { ProjectConfig } from '../types.js';
import {
  type PreparedWorkItemRepository,
  ensureSelectedRepositoryCheckout,
} from './checkout-readiness.js';
import { resolveRepositoryForWorkItem } from './repo-affinity.js';

export function resolveSelectedRepositoryCheckout(input: {
  project: ProjectConfig | null | undefined;
  workItem: WorkItem;
  fallbackLocalPath: string;
}): PreparedWorkItemRepository {
  const projectForManagedCheckout = input.workItem.id.startsWith('local:') ? input.project : null;
  return ensureSelectedRepositoryCheckout(
    projectForManagedCheckout,
    resolveRepositoryForWorkItem({
      project: input.project,
      workItem: input.workItem,
      fallbackLocalPath: input.fallbackLocalPath,
    }),
  );
}
