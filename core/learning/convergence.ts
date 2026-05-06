import { type SQL, and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRunCosts, archivedLifecycles } from '../db/schema.js';

export type Trend = 'improving' | 'stable' | 'declining';

const IMPROVING_THRESHOLD = 0.05;
const DECLINING_THRESHOLD = -0.05;

export interface ComputeTrendInput {
  projectId: string;
  role: string;
  skill?: string;
  windowSize?: number;
}

export interface TrendResult {
  trend: Trend;
  sampleCount: number;
  delta: number;
}

export function computeTrend(input: ComputeTrendInput): TrendResult {
  const { projectId, role, skill, windowSize = 5 } = input;

  const conditions: SQL[] = [eq(archivedLifecycles.projectId, projectId)];

  // Skill filter: narrow the window to lifecycles whose runs included the
  // requested skill. Without this, callers passing `skill` would receive a
  // role-wide trend that mixes scores from unrelated skills.
  if (skill != null) {
    const skillWorkItems = db
      .selectDistinct({ workItemId: agentRunCosts.workItemId })
      .from(agentRunCosts)
      .where(and(eq(agentRunCosts.projectId, projectId), eq(agentRunCosts.skill, skill)))
      .all();
    const ids = skillWorkItems
      .map((r) => r.workItemId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return { trend: 'stable', sampleCount: 0, delta: 0 };
    }
    conditions.push(inArray(archivedLifecycles.workItemId, ids));
  }

  const rows = db
    .select()
    .from(archivedLifecycles)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(archivedLifecycles.closedAt))
    .limit(windowSize)
    .all();

  if (rows.length === 0) {
    return { trend: 'stable', sampleCount: 0, delta: 0 };
  }

  // Reverse to chronological order for trend calculation
  const chronological = [...rows].reverse();

  type QualityScore = { personaId?: string; score?: number };

  const scores: number[] = [];
  for (const row of chronological) {
    const qualityScores: QualityScore[] = JSON.parse(row.qualityScores);
    const roleScores = qualityScores.filter((qs) => {
      if (!qs.personaId) return false;
      const parts = qs.personaId.split('/');
      const extractedRole = parts.length >= 2 ? parts[parts.length - 2] : '';
      return extractedRole === role;
    });
    if (roleScores.length > 0) {
      const avg = roleScores.reduce((sum, qs) => sum + (qs.score ?? 0), 0) / roleScores.length;
      scores.push(avg);
    }
  }

  if (scores.length === 0) {
    return { trend: 'stable', sampleCount: 0, delta: 0 };
  }

  if (scores.length === 1) {
    return { trend: 'stable', sampleCount: 1, delta: 0 };
  }

  const half = Math.floor(scores.length / 2);
  const earlyScores = scores.slice(0, half);
  const lateScores = scores.slice(scores.length - half);

  const earlyAvg = earlyScores.reduce((sum, s) => sum + s, 0) / earlyScores.length;
  const lateAvg = lateScores.reduce((sum, s) => sum + s, 0) / lateScores.length;
  const delta = lateAvg - earlyAvg;

  let trend: Trend;
  if (delta > IMPROVING_THRESHOLD) {
    trend = 'improving';
  } else if (delta < DECLINING_THRESHOLD) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  return { trend, sampleCount: scores.length, delta };
}
