import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/db.js';
import { archivedLifecycles, decisionPatterns } from '../db/schema.js';
import type { ArchivedDecisionSummary } from './archive.js';

export interface MinePatternsInput {
  projectId: string;
  since?: string;
}

interface GroupEntry {
  workItemIds: string[];
  summaries: string[];
}

export function minePatterns(input: MinePatternsInput): void {
  const { projectId, since } = input;

  const conditions = [eq(archivedLifecycles.projectId, projectId)];
  if (since != null) {
    conditions.push(gte(archivedLifecycles.closedAt, since));
  }

  const rows = db
    .select()
    .from(archivedLifecycles)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .all();

  const groups = new Map<string, GroupEntry & { kind: string; role: string }>();

  for (const row of rows) {
    const summaries: ArchivedDecisionSummary[] = JSON.parse(row.decisionSummaries);
    for (const ds of summaries) {
      const key = `${ds.kind}::${ds.role}`;
      const existing = groups.get(key);
      if (existing == null) {
        groups.set(key, {
          kind: ds.kind,
          role: ds.role,
          workItemIds: [row.workItemId],
          summaries: [ds.summary],
        });
      } else {
        existing.summaries.push(ds.summary);
        if (!existing.workItemIds.includes(row.workItemId)) {
          existing.workItemIds.push(row.workItemId);
        }
      }
    }
  }

  const now = new Date().toISOString();

  for (const group of groups.values()) {
    const { kind, role, summaries, workItemIds } = group;

    const frequencyMap = new Map<string, number>();
    for (const s of summaries) {
      frequencyMap.set(s, (frequencyMap.get(s) ?? 0) + 1);
    }

    let topAction = '';
    let topCount = 0;
    for (const [s, c] of frequencyMap) {
      if (c > topCount) {
        topCount = c;
        topAction = s;
      }
    }

    const consistencyScore = summaries.length > 0 ? topCount / summaries.length : 0;
    const exampleWorkItemIds = workItemIds.slice(0, 5);

    db.insert(decisionPatterns)
      .values({
        projectId,
        kind,
        role,
        actionSummary: topAction,
        reasonSummary: '',
        occurrenceCount: summaries.length,
        consistencyScore,
        lastSeenAt: now,
        exampleWorkItemIds: JSON.stringify(exampleWorkItemIds),
      })
      .onConflictDoUpdate({
        target: [decisionPatterns.projectId, decisionPatterns.kind, decisionPatterns.role],
        set: {
          actionSummary: topAction,
          occurrenceCount: summaries.length,
          consistencyScore,
          lastSeenAt: now,
          exampleWorkItemIds: JSON.stringify(exampleWorkItemIds),
        },
      })
      .run();
  }
}
