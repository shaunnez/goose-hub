import { eventStore } from '../event-stream/store.js';

export type LatestPrdSource = 'event';

export interface LatestPrdResult {
  prd: unknown | null;
  advisorConcerns: string | null;
  source: LatestPrdSource;
  createdAt: string;
  runId: string | null;
}

export interface ResolveLatestPrdInput {
  projectId: string;
  workItemId: string;
}

interface PrdDraftedPayload {
  prd?: unknown;
  advisorConcerns?: unknown;
}

function normalizeAdvisorConcerns(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const concerns = value.filter((item): item is string => typeof item === 'string');
    return concerns.length > 0 ? concerns.map((item) => `- ${item}`).join('\n') : null;
  }
  return null;
}

export async function resolveLatestPrd(
  input: ResolveLatestPrdInput,
): Promise<LatestPrdResult | null> {
  const draftedEvents = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'prd.drafted',
  });
  const latestDrafted = draftedEvents.at(-1);
  if (latestDrafted != null) {
    const payload = latestDrafted.payload as PrdDraftedPayload;
    if (payload.prd != null) {
      return {
        prd: payload.prd,
        advisorConcerns: normalizeAdvisorConcerns(payload.advisorConcerns),
        source: 'event',
        createdAt: latestDrafted.createdAt,
        runId: latestDrafted.runId ?? null,
      };
    }
  }

  return null;
}
