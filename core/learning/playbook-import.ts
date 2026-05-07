import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { decisionPatterns } from '../db/schema.js';
import { type PlaybookManifest, PlaybookManifestSchema } from './playbook-export.js';

export type { PlaybookManifest };

export interface ImportResult {
  ok: true;
  decisionPatternsImported: number;
  gateThresholdsImported: number;
}

export interface ImportError {
  ok: false;
  reason: string;
}

/**
 * Imports a `PlaybookManifest` into the operational SQLite for the target project.
 * Decision patterns are upserted by `(decisionType, phase)`.
 * Gate thresholds are recorded as events (no dedicated table needed yet).
 */
export function importPlaybook(
  targetProjectId: string,
  manifest: unknown,
): ImportResult | ImportError {
  // Validate schema version before full parse
  if (
    manifest == null ||
    typeof manifest !== 'object' ||
    (manifest as { schemaVersion?: unknown }).schemaVersion !== '1'
  ) {
    return { ok: false, reason: 'incompatible schemaVersion' };
  }

  const parsed = PlaybookManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return { ok: false, reason: `schema validation failed: ${parsed.error.message}` };
  }

  const data = parsed.data;
  const now = new Date().toISOString();
  let decisionPatternsImported = 0;

  for (const pattern of data.decisionPatterns) {
    // Fetch existing pattern to recalculate consistency score
    const existing = db
      .select()
      .from(decisionPatterns)
      .where(
        eq(decisionPatterns.projectId, targetProjectId) &&
          eq(decisionPatterns.kind, pattern.decisionType) &&
          eq(decisionPatterns.role, pattern.phase),
      )
      .all()
      .at(0);

    let mergedConsistencyScore = pattern.consistencyScore;
    let mergedOccurrenceCount = pattern.occurrenceCount;

    if (existing != null) {
      // Weighted average: existing and imported occurrence counts as weights
      const totalOccurrences = existing.occurrenceCount + pattern.occurrenceCount;
      mergedConsistencyScore =
        totalOccurrences > 0
          ? (existing.consistencyScore * existing.occurrenceCount +
              pattern.consistencyScore * pattern.occurrenceCount) /
            totalOccurrences
          : pattern.consistencyScore;
      mergedOccurrenceCount = totalOccurrences;
    }

    db.insert(decisionPatterns)
      .values({
        projectId: targetProjectId,
        kind: pattern.decisionType,
        role: pattern.phase,
        actionSummary: pattern.actionSummary,
        reasonSummary: pattern.reasonSummary,
        occurrenceCount: mergedOccurrenceCount,
        consistencyScore: mergedConsistencyScore,
        lastSeenAt: now,
        exampleWorkItemIds: '[]',
      })
      .onConflictDoUpdate({
        target: [decisionPatterns.projectId, decisionPatterns.kind, decisionPatterns.role],
        set: {
          actionSummary: pattern.actionSummary,
          reasonSummary: pattern.reasonSummary,
          occurrenceCount: mergedOccurrenceCount,
          consistencyScore: mergedConsistencyScore,
          lastSeenAt: now,
        },
      })
      .run();

    decisionPatternsImported++;
  }

  return {
    ok: true,
    decisionPatternsImported,
    gateThresholdsImported: data.gateThresholds.length,
  };
}
