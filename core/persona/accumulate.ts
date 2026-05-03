import { and, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { personaStats } from '../db/schema.js';

export interface AccumulateInput {
  personaName: string;
  role: string;
  outcome: 'success' | 'failure' | 'partial';
  qualityScore?: number;
}

function estimateQuality(outcome: 'success' | 'failure' | 'partial'): number {
  if (outcome === 'success') return 1.0;
  if (outcome === 'partial') return 0.5;
  return 0.0;
}

export function accumulatePersonaStats(input: AccumulateInput): void {
  const { personaName, role, outcome, qualityScore } = input;
  const score = qualityScore ?? estimateQuality(outcome);
  const succeeded = outcome === 'success' ? 1 : 0;
  const failed = outcome !== 'success' ? 1 : 0;

  const existing = db
    .select()
    .from(personaStats)
    .where(and(eq(personaStats.personaName, personaName), eq(personaStats.role, role)))
    .all();

  if (existing.length === 0) {
    db.insert(personaStats)
      .values({
        personaName,
        role,
        runsTotal: 1,
        runsSucceeded: succeeded,
        runsFailed: failed,
        avgQualityScore: score,
        lastRunAt: new Date().toISOString(),
      })
      .run();
    return;
  }

  const row = existing[0];
  const newTotal = row.runsTotal + 1;
  const newAvg = (row.avgQualityScore * row.runsTotal + score) / newTotal;

  db.update(personaStats)
    .set({
      runsTotal: newTotal,
      runsSucceeded: row.runsSucceeded + succeeded,
      runsFailed: row.runsFailed + failed,
      avgQualityScore: newAvg,
      lastRunAt: new Date().toISOString(),
    })
    .where(and(eq(personaStats.personaName, personaName), eq(personaStats.role, role)))
    .run();
}
