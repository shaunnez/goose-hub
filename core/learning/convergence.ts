import { db } from '@goose-hub/core/db/db.js';
import { archivedLifecycles } from '@goose-hub/core/db/schema.js';
import type { QualityScore } from '@goose-hub/core/retrospective/schemas.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Computes trend based on recent quality scores from archived lifecycles.
 * Examines a sliding window of recent runs and computes delta.
 *
 * Thresholds: improving > +0.05, declining < -0.05, otherwise stable.
 */
export function computeTrend({
  projectId,
  role,
  skill,
  windowSize = 5,
}: {
  projectId: string;
  role: string; // Unused for now, kept for future filtering
  skill?: string;
  windowSize?: number;
}): 'improving' | 'stable' | 'declining' {
  // Fetch recent archived lifecycles, ordered by closedAt descending
  const lifecycles = db
    .select()
    .from(archivedLifecycles)
    .where(eq(archivedLifecycles.projectId, projectId))
    .orderBy(sql`${archivedLifecycles.closedAt} DESC`)
    .limit(windowSize)
    .all()
    .reverse(); // Reverse to get chronological order (oldest first)

  if (lifecycles.length < 2) {
    // Not enough data to compute trend
    return 'stable';
  }

  // Extract quality scores from each lifecycle
  const scores: number[] = [];
  for (const lifecycle of lifecycles) {
    try {
      const qualityScoresJson: QualityScore[] = JSON.parse(lifecycle.qualityScores as string);
      if (qualityScoresJson.length > 0) {
        // Use the first persona's score (typically the primary actor)
        scores.push(qualityScoresJson[0].score);
      }
    } catch (_e) {
      // Skip malformed JSON
    }
  }

  if (scores.length < 2) {
    return 'stable';
  }

  // Compute trend: delta between last and first
  const firstScore = scores[0];
  const lastScore = scores[scores.length - 1];
  const delta = lastScore - firstScore;

  const IMPROVING_THRESHOLD = 0.05;
  const DECLINING_THRESHOLD = -0.05;

  if (delta > IMPROVING_THRESHOLD) {
    return 'improving';
  }
  if (delta < DECLINING_THRESHOLD) {
    return 'declining';
  }
  return 'stable';
}
