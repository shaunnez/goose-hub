import { eventStore } from '../event-stream/store.js';

const PRD_MARKER = '<!-- factory:prd -->';
const JSON_FENCE = /```json\s*\n([\s\S]*?)\n```/;
const ADVISOR_HEADING = /\n##\s+Advisor concerns\s*\n/;

export type LatestPrdSource = 'event' | 'legacy-comment';

export interface LegacyPrdComment {
  body: string;
  createdAt: string;
}

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
  loadLegacyComments?: () => Promise<ReadonlyArray<LegacyPrdComment>>;
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

export function isLegacyPrdMarkerComment(body: string): boolean {
  return body.startsWith(PRD_MARKER);
}

export function parseLegacyPrdComment(
  body: string,
): Pick<LatestPrdResult, 'prd' | 'advisorConcerns'> {
  if (!isLegacyPrdMarkerComment(body)) return { prd: null, advisorConcerns: null };

  const fenceMatch = body.match(JSON_FENCE);
  let prd: unknown | null = null;
  if (fenceMatch != null) {
    try {
      prd = JSON.parse(fenceMatch[1]);
    } catch {
      prd = null;
    }
  }

  const advisorIdx = body.search(ADVISOR_HEADING);
  const advisorConcerns =
    advisorIdx >= 0 ? body.slice(advisorIdx).replace(ADVISOR_HEADING, '').trimEnd() : null;

  return { prd, advisorConcerns };
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

  if (input.loadLegacyComments == null) return null;

  const comments = await input.loadLegacyComments();
  const matches = comments.filter((comment) => isLegacyPrdMarkerComment(comment.body));
  if (matches.length === 0) return null;

  const sorted = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  const parsed = parseLegacyPrdComment(latest.body);
  return {
    ...parsed,
    source: 'legacy-comment',
    createdAt: latest.createdAt,
    runId: null,
  };
}
