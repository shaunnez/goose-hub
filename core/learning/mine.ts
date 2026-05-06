import { db } from '@goose-hub/core/db/db.js';
import { archivedLifecycles, decisionPatterns } from '@goose-hub/core/db/schema.js';
import type { DecisionSummary } from '@goose-hub/core/retrospective/schemas.js';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Mines decision patterns from archived lifecycles.
 * Groups decision summaries by (kind, role), computes consistency scores,
 * and upserts rows into decision_patterns table.
 * Idempotent: safe to call multiple times; re-mines all patterns from scratch.
 */
export function minePatterns({
  projectId,
  since,
}: {
  projectId: string;
  since?: string;
}): void {
  // Fetch archived lifecycles for this project
  const lifecycles = db
    .select()
    .from(archivedLifecycles)
    .where(
      since
        ? and(
            eq(archivedLifecycles.projectId, projectId),
            sql`${archivedLifecycles.closedAt} >= ${since}`,
          )
        : eq(archivedLifecycles.projectId, projectId),
    )
    .all();

  if (lifecycles.length === 0) {
    return;
  }

  // Group decisions by (kind, role)
  // For now, role is inferred as 'developer' since it's not on decisions
  // In future, this could come from runSummary context or persona role
  const patternMap = new Map<
    string,
    {
      kind: string;
      role: string;
      actionSummaries: string[];
      reasonSummaries: string[];
      count: number;
      exampleWorkItems: Set<string>;
      lastSeen: string;
    }
  >();

  for (const lifecycle of lifecycles) {
    const workItemId = lifecycle.workItemId || 'unknown';
    const lastSeen = lifecycle.closedAt;

    try {
      const decisions: DecisionSummary[] = JSON.parse(lifecycle.decisionSummaries as string);
      for (const decision of decisions) {
        const key = `${decision.kind}:developer`; // role hardcoded to 'developer' for now
        let pattern = patternMap.get(key);
        if (!pattern) {
          pattern = {
            kind: decision.kind,
            role: 'developer',
            actionSummaries: [],
            reasonSummaries: [],
            count: 0,
            exampleWorkItems: new Set(),
            lastSeen,
          };
          patternMap.set(key, pattern);
        }

        pattern.count += 1;
        pattern.actionSummaries.push(decision.summary);
        if (decision.evidence) {
          pattern.reasonSummaries.push(decision.evidence);
        }
        if (pattern.exampleWorkItems.size < 5) {
          pattern.exampleWorkItems.add(workItemId);
        }
        if (lastSeen > pattern.lastSeen) {
          pattern.lastSeen = lastSeen;
        }
      }
    } catch (_e) {
      // Skip malformed JSON
    }
  }

  // Idempotent: delete existing patterns for this project, then insert fresh
  db.delete(decisionPatterns).where(eq(decisionPatterns.projectId, projectId)).run();

  // Insert patterns into DB
  for (const [, pattern] of patternMap) {
    const totalDecisions = lifecycles.length; // Total lifecycles analyzed
    const consistencyScore = pattern.count / totalDecisions;
    const exampleWorkItemIds = JSON.stringify(Array.from(pattern.exampleWorkItems));

    db.insert(decisionPatterns)
      .values({
        projectId,
        kind: pattern.kind,
        role: pattern.role,
        actionSummary: pattern.actionSummaries[0] || '',
        reasonSummary: pattern.reasonSummaries[0] || '',
        occurrenceCount: pattern.count,
        consistencyScore,
        lastSeenAt: pattern.lastSeen,
        exampleWorkItemIds,
      })
      .run();
  }
}
