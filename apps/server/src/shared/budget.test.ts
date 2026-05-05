import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/db/db.js', () => ({ db: { select: vi.fn() } }));
vi.mock('@goose-hub/core/db/schema.js', () => ({ agentRunCosts: {} }));
vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn() }));

import { db } from '@goose-hub/core/db/db.js';
import { checkDailyBudget, getDailyUsage } from './budget.js';

function mockDbRows(rows: { costUsd: number; inputTokens: number; outputTokens: number }[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db).select = vi.fn().mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDailyUsage', () => {
  it('returns zero totals when no runs exist today', async () => {
    mockDbRows([]);
    const usage = await getDailyUsage('proj-a');
    expect(usage.totalCostUsd).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it('sums cost and tokens across all runs for the project', async () => {
    mockDbRows([
      { costUsd: 0.5, inputTokens: 1000, outputTokens: 500 },
      { costUsd: 0.3, inputTokens: 600, outputTokens: 200 },
    ]);
    const usage = await getDailyUsage('proj-a');
    expect(usage.totalCostUsd).toBeCloseTo(0.8);
    expect(usage.totalTokens).toBe(2300);
  });
});

describe('checkDailyBudget', () => {
  it('returns exceeded=false when usage is under the limit', async () => {
    mockDbRows([{ costUsd: 0.1, inputTokens: 100, outputTokens: 50 }]);
    const result = await checkDailyBudget('proj-a', 500_000);
    expect(result.exceeded).toBe(false);
    expect(result.limitTokens).toBe(500_000);
    expect(result.usage.totalTokens).toBe(150);
  });

  it('returns exceeded=true with reason when daily token limit is reached', async () => {
    mockDbRows([{ costUsd: 1.0, inputTokens: 300_000, outputTokens: 200_000 }]);
    const result = await checkDailyBudget('proj-a', 500_000);
    expect(result.exceeded).toBe(true);
    expect(result.reason).toBe('daily-tokens');
    expect(result.usage.totalTokens).toBe(500_000);
  });

  it('two projects are independent — exceeding one does not affect the other', async () => {
    // proj-a: over limit
    mockDbRows([{ costUsd: 1.0, inputTokens: 400_000, outputTokens: 200_000 }]);
    const resultA = await checkDailyBudget('proj-a', 500_000);
    expect(resultA.exceeded).toBe(true);

    // proj-b: under limit
    mockDbRows([{ costUsd: 0.05, inputTokens: 10_000, outputTokens: 5_000 }]);
    const resultB = await checkDailyBudget('proj-b', 500_000);
    expect(resultB.exceeded).toBe(false);
  });

  it('never exceeded when limitTokens is 0 (no-limit sentinel)', async () => {
    mockDbRows([{ costUsd: 99, inputTokens: 9_999_999, outputTokens: 9_999_999 }]);
    const result = await checkDailyBudget('proj-a', 0);
    expect(result.exceeded).toBe(false);
  });
});
