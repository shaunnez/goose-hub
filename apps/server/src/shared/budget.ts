import { db } from '@goose-hub/core/db/db.js';
import { agentRunCosts } from '@goose-hub/core/db/schema.js';
import { and, eq, gte, lt } from 'drizzle-orm';

export interface DailyUsage {
  totalCostUsd: number;
  totalTokens: number;
}

export interface BudgetCheckResult {
  exceeded: boolean;
  reason?: 'daily-tokens';
  usage: DailyUsage;
  limitTokens: number;
}

/** Returns today's (UTC) aggregated cost and token usage for a project. */
export async function getDailyUsage(projectId: string): Promise<DailyUsage> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      costUsd: agentRunCosts.costUsd,
      inputTokens: agentRunCosts.inputTokens,
      outputTokens: agentRunCosts.outputTokens,
    })
    .from(agentRunCosts)
    .where(
      and(
        eq(agentRunCosts.projectId, projectId),
        gte(agentRunCosts.createdAt, `${today}T00:00:00Z`),
        lt(agentRunCosts.createdAt, `${tomorrow}T00:00:00Z`),
      ),
    );

  const totalCostUsd = rows.reduce((acc, r) => acc + r.costUsd, 0);
  const totalTokens = rows.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
  return { totalCostUsd, totalTokens };
}

/**
 * Checks whether a project has exceeded its daily token budget.
 * A limitTokens of 0 is treated as "no limit" (never exceeded).
 */
export async function checkDailyBudget(
  projectId: string,
  limitTokens: number,
): Promise<BudgetCheckResult> {
  const usage = await getDailyUsage(projectId);
  if (limitTokens > 0 && usage.totalTokens >= limitTokens) {
    return { exceeded: true, reason: 'daily-tokens', usage, limitTokens };
  }
  return { exceeded: false, usage, limitTokens };
}
