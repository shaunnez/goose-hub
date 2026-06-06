import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
import type { Role } from '../types.js';

export interface AgentRunRecord {
  runId: string;
  personaId: string;
  workItemId: string | null;
  projectId: string;
  role: Role;
  skill: string;
  outcome: 'success' | 'failure';
}

/** Persists an agent_runs row. Idempotent on runId. Called by both runtimes. */
export function recordAgentRun(record: AgentRunRecord): void {
  db.insert(agentRuns)
    .values({
      runId: record.runId,
      personaId: record.personaId,
      workItemId: record.workItemId,
      projectId: record.projectId,
      role: record.role,
      skill: record.skill,
      outcome: record.outcome,
    })
    .onConflictDoNothing({ target: agentRuns.runId })
    .run();

  if (record.outcome === 'failure') {
    db.update(agentRuns)
      .set({ outcome: 'failure' })
      .where(eq(agentRuns.runId, record.runId))
      .run();
  }
}
