import { db } from '@goose-hub/core/db/db.js';
import { archivedLifecycles, decisionPatterns } from '@goose-hub/core/db/schema.js';
import { computeTrend } from '@goose-hub/core/learning/convergence.js';
import { minePatterns } from '@goose-hub/core/learning/mine.js';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT = 'learning-slice-test';

beforeAll(() => {
  // Create archived_lifecycles table
  db.run(sql`CREATE TABLE IF NOT EXISTS archived_lifecycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    decision_summaries TEXT NOT NULL,
    learning_entries TEXT NOT NULL,
    quality_scores TEXT NOT NULL,
    costs_usd REAL NOT NULL DEFAULT 0,
    run_ids TEXT NOT NULL
  )`);

  // Create decision_patterns table
  db.run(sql`CREATE TABLE IF NOT EXISTS decision_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    action_summary TEXT NOT NULL,
    reason_summary TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    consistency_score REAL NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL,
    example_work_item_ids TEXT NOT NULL
  )`);
});

beforeEach(() => {
  db.delete(archivedLifecycles).where(sql`project_id = ${PROJECT}`).run();
  db.delete(decisionPatterns).where(sql`project_id = ${PROJECT}`).run();
});

afterAll(() => {
  db.delete(archivedLifecycles).where(sql`project_id = ${PROJECT}`).run();
  db.delete(decisionPatterns).where(sql`project_id = ${PROJECT}`).run();
});

describe('learning slice — lifecycle archive + pattern mining + convergence', () => {
  describe('archived_lifecycles table', () => {
    it('stores a lifecycle archive with all required fields', () => {
      const decisionSummaries = JSON.stringify([
        { kind: 'PLAN', summary: 'Started planning' },
        { kind: 'RED', summary: 'Wrote failing tests' },
      ]);
      const learningEntries = JSON.stringify([
        {
          observation: 'Test pattern X is effective',
          rationale: 'High signal',
          improvementKind: 'skill-prompt',
          confidence: 'high',
        },
      ]);
      const qualityScores = JSON.stringify([
        {
          personaId: 'p1',
          score: 0.85,
          trend: 'improving',
          sampleCount: 3,
          rationale: 'Consistent output',
        },
      ]);

      db.insert(archivedLifecycles)
        .values({
          projectId: PROJECT,
          workItemId: 'github:owner/repo#42',
          closedAt: new Date().toISOString(),
          decisionSummaries,
          learningEntries,
          qualityScores,
          costsUsd: 0.15,
          runIds: JSON.stringify(['run-1', 'run-2']),
        })
        .run();

      const rows = db.select().from(archivedLifecycles).where(sql`project_id = ${PROJECT}`).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: PROJECT,
        workItemId: 'github:owner/repo#42',
        costsUsd: 0.15,
      });
      expect(rows[0].decisionSummaries).toBe(decisionSummaries);
      expect(rows[0].learningEntries).toBe(learningEntries);
      expect(rows[0].qualityScores).toBe(qualityScores);
      expect(JSON.parse(rows[0].runIds as string)).toEqual(['run-1', 'run-2']);
    });
  });

  describe('decision_patterns table & minePatterns', () => {
    it('groups decision summaries by kind and role, computes consistency score', () => {
      // Insert two lifecycles with similar decisions
      const decisionSummaries1 = JSON.stringify([
        { kind: 'RED', summary: 'Wrote failing test for X' },
        { kind: 'GREEN', summary: 'Implemented X' },
      ]);
      const decisionSummaries2 = JSON.stringify([
        { kind: 'RED', summary: 'Wrote failing test for Y' },
        { kind: 'GREEN', summary: 'Implemented Y' },
      ]);

      db.insert(archivedLifecycles)
        .values({
          projectId: PROJECT,
          workItemId: 'github:owner/repo#1',
          closedAt: new Date().toISOString(),
          decisionSummaries: decisionSummaries1,
          learningEntries: '[]',
          qualityScores: '[]',
          costsUsd: 0.1,
          runIds: JSON.stringify(['run-1']),
        })
        .run();

      db.insert(archivedLifecycles)
        .values({
          projectId: PROJECT,
          workItemId: 'github:owner/repo#2',
          closedAt: new Date().toISOString(),
          decisionSummaries: decisionSummaries2,
          learningEntries: '[]',
          qualityScores: '[]',
          costsUsd: 0.1,
          runIds: JSON.stringify(['run-2']),
        })
        .run();

      // Run miner
      minePatterns({ projectId: PROJECT });

      const patterns = db.select().from(decisionPatterns).where(sql`project_id = ${PROJECT}`).all();
      expect(patterns.length).toBeGreaterThan(0);

      // Check RED pattern
      const redPattern = patterns.find((p) => p.kind === 'RED');
      expect(redPattern).toBeDefined();
      if (redPattern) {
        expect(redPattern.occurrenceCount).toBe(2);
        expect(redPattern.consistencyScore).toBeCloseTo(1.0); // Both RED
      }

      // Check GREEN pattern
      const greenPattern = patterns.find((p) => p.kind === 'GREEN');
      expect(greenPattern).toBeDefined();
      if (greenPattern) {
        expect(greenPattern.occurrenceCount).toBe(2);
        expect(greenPattern.consistencyScore).toBeCloseTo(1.0);
      }
    });

    it('upserts patterns, updating consistency score and occurrence count', () => {
      const summaries1 = JSON.stringify([{ kind: 'PLAN', summary: 'Plan A' }]);
      const summaries2 = JSON.stringify([{ kind: 'PLAN', summary: 'Plan B' }]);
      const summaries3 = JSON.stringify([{ kind: 'RED', summary: 'Red' }]);

      // First lifecycle with PLAN
      db.insert(archivedLifecycles)
        .values({
          projectId: PROJECT,
          workItemId: 'github:owner/repo#1',
          closedAt: new Date().toISOString(),
          decisionSummaries: summaries1,
          learningEntries: '[]',
          qualityScores: '[]',
          costsUsd: 0.1,
          runIds: JSON.stringify(['run-1']),
        })
        .run();

      minePatterns({ projectId: PROJECT });
      let patterns = db.select().from(decisionPatterns).where(sql`project_id = ${PROJECT}`).all();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrenceCount).toBe(1);

      // Second lifecycle with PLAN and RED
      db.insert(archivedLifecycles)
        .values({
          projectId: PROJECT,
          workItemId: 'github:owner/repo#2',
          closedAt: new Date().toISOString(),
          decisionSummaries: JSON.stringify([JSON.parse(summaries2)[0], JSON.parse(summaries3)[0]]),
          learningEntries: '[]',
          qualityScores: '[]',
          costsUsd: 0.1,
          runIds: JSON.stringify(['run-2']),
        })
        .run();

      minePatterns({ projectId: PROJECT });
      patterns = db.select().from(decisionPatterns).where(sql`project_id = ${PROJECT}`).all();
      const planPattern = patterns.find((p) => p.kind === 'PLAN');
      expect(planPattern?.occurrenceCount).toBe(2);
    });

    it('handles empty archive without error', () => {
      expect(() => minePatterns({ projectId: PROJECT })).not.toThrow();
      const patterns = db.select().from(decisionPatterns).where(sql`project_id = ${PROJECT}`).all();
      expect(patterns).toHaveLength(0);
    });
  });

  describe('computeTrend', () => {
    it('returns improving trend when quality scores rise over window', () => {
      const now = new Date();
      [0.5, 0.6, 0.7, 0.8, 0.9].forEach((score, i) => {
        db.insert(archivedLifecycles)
          .values({
            projectId: PROJECT,
            workItemId: `github:owner/repo#${i}`,
            closedAt: new Date(now.getTime() + i * 86400000).toISOString(),
            decisionSummaries: '[]',
            learningEntries: '[]',
            qualityScores: JSON.stringify([
              { personaId: 'p1', score, trend: 'improving', sampleCount: 1, rationale: 'test' },
            ]),
            costsUsd: 0.1,
            runIds: JSON.stringify(['run']),
          })
          .run();
      });

      const trend = computeTrend({ projectId: PROJECT, role: 'developer' });
      expect(trend).toBe('improving');
    });

    it('returns declining trend when quality scores fall over window', () => {
      const now = new Date();
      [0.9, 0.8, 0.7, 0.6, 0.5].forEach((score, i) => {
        db.insert(archivedLifecycles)
          .values({
            projectId: PROJECT,
            workItemId: `github:owner/repo#${i}`,
            closedAt: new Date(now.getTime() + i * 86400000).toISOString(),
            decisionSummaries: '[]',
            learningEntries: '[]',
            qualityScores: JSON.stringify([
              { personaId: 'p1', score, trend: 'declining', sampleCount: 1, rationale: 'test' },
            ]),
            costsUsd: 0.1,
            runIds: JSON.stringify(['run']),
          })
          .run();
      });

      const trend = computeTrend({ projectId: PROJECT, role: 'developer' });
      expect(trend).toBe('declining');
    });

    it('returns stable trend when quality scores are flat over window', () => {
      const now = new Date();
      [0.75, 0.74, 0.76, 0.75, 0.74].forEach((score, i) => {
        db.insert(archivedLifecycles)
          .values({
            projectId: PROJECT,
            workItemId: `github:owner/repo#${i}`,
            closedAt: new Date(now.getTime() + i * 86400000).toISOString(),
            decisionSummaries: '[]',
            learningEntries: '[]',
            qualityScores: JSON.stringify([
              { personaId: 'p1', score, trend: 'stable', sampleCount: 1, rationale: 'test' },
            ]),
            costsUsd: 0.1,
            runIds: JSON.stringify(['run']),
          })
          .run();
      });

      const trend = computeTrend({ projectId: PROJECT, role: 'developer' });
      expect(trend).toBe('stable');
    });

    it('handles empty archive, returns stable', () => {
      const trend = computeTrend({ projectId: PROJECT, role: 'developer' });
      expect(trend).toBe('stable');
    });

    it('respects custom windowSize', () => {
      const now = new Date();
      [0.5, 0.6, 0.7, 0.8, 0.9].forEach((score, i) => {
        db.insert(archivedLifecycles)
          .values({
            projectId: PROJECT,
            workItemId: `github:owner/repo#${i}`,
            closedAt: new Date(now.getTime() + i * 86400000).toISOString(),
            decisionSummaries: '[]',
            learningEntries: '[]',
            qualityScores: JSON.stringify([
              { personaId: 'p1', score, trend: 'improving', sampleCount: 1, rationale: 'test' },
            ]),
            costsUsd: 0.1,
            runIds: JSON.stringify(['run']),
          })
          .run();
      });

      // Use last 2 only (scores 0.8, 0.9) — still improving
      const trend = computeTrend({ projectId: PROJECT, role: 'developer', windowSize: 2 });
      expect(trend).toBe('improving');
    });
  });
});
