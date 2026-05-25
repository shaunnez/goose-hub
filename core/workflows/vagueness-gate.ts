import type { WorkItem } from '../state-source/interface.js';

export type VaguenessTier = 'high' | 'low';
export type MissingVaguenessDimension = 'repro' | 'criteria';

export interface VaguenessScore {
  score: number;
  missingDimensions: MissingVaguenessDimension[];
  tier: VaguenessTier;
}

const HIGH_VAGUENESS_CUTOFF = 50;

const HEDGING_RE =
  /\b(something|somehow|maybe|unclear|not sure|weird|broken|better|stuff|thing|things|sort of|kind of|probably)\b/i;
const REPRO_RE =
  /\b(steps? to reproduce|repro(?:duce|duction)?|given|when|then|actual|observed|error|exception|crash|screenshot|recording)\b/i;
const CRITERIA_RE =
  /\b(acceptance criteria|success criteria|done when|expected|should|must|verify|test passes?|passes when)\b/i;
const SURFACE_RE =
  /\b(apps\/|core\/|slices\/|skills\/|components?[:\s]|routes?[:\s]|files?[:\s]|https?:\/\/|\/[a-z0-9][^\s]*)/i;

export function scoreVagueness(
  workItem: Pick<WorkItem, 'title' | 'body' | 'type'>,
): VaguenessScore {
  const text = `${workItem.title}\n${workItem.body}`.trim();
  const body = workItem.body.trim();
  const missingDimensions: MissingVaguenessDimension[] = [];
  let score = 0;

  if (body.length < 80) score += 30;
  else if (body.length < 200) score += 15;

  if (workItem.type === 'bug' && !REPRO_RE.test(text)) {
    missingDimensions.push('repro');
    score += 25;
  }

  if (workItem.type !== 'research' && !CRITERIA_RE.test(text)) {
    missingDimensions.push('criteria');
    score += 25;
  }

  if (HEDGING_RE.test(text)) score += 20;
  if (!SURFACE_RE.test(text)) score += 10;

  const cappedScore = Math.min(score, 100);
  return {
    score: cappedScore,
    missingDimensions,
    tier: cappedScore >= HIGH_VAGUENESS_CUTOFF ? 'high' : 'low',
  };
}
