import { describe, expect, it } from 'vitest';
import { selectWorkflowRoute } from './select-route.js';
import type { RouteSignals } from './types.js';

// #1178 acceptance fixture
const FIXTURE_1178: RouteSignals = {
  workItemId: 'github:shaunnez/goose-hub#1178',
  workItemType: 'bug',
  seedFileCount: 2,
  hasVagueOrHighRisk: false,
  hasSensitivePath: false,
  hasSchemaSignal: false,
  hasDependencySignal: false,
  investigationConfidence: 'high',
  nonTestFileCount: 1,
  hasContradictions: false,
  wave2Triggered: false,
};

describe('selectWorkflowRoute', () => {
  it('#1178 fixture: resolves T1, maxUsd 0.80, single scout, no Wave-2, fix-issue stages', () => {
    const route = selectWorkflowRoute(FIXTURE_1178, 'investigation');
    expect(route.tier).toBe('T1');
    expect(route.budgetCaps.maxUsd).toBe(0.8);
    expect(route.budgetCaps.maxScouts).toBe(1);
    expect(route.budgetCaps.allowWave2).toBe(false);
    expect(route.budgetCaps.reviewerSlots).toBe(1);
    expect(route.selectedStages).toContain('implement');
    expect(route.selectedStages).not.toContain('parallel-implement');
    expect(route.selectedStages).not.toContain('spec-author');
    expect(route.requiresHumanApproval).toBe(false);
    expect(route.escalationTriggers).toHaveLength(0);
    expect(route.source).toBe('investigation');
    expect(route.rootCauseSignature).toBe('route|github:shaunnez/goose-hub#1178|workflow-routing');
  });

  describe('preliminary tier (no investigation)', () => {
    it('vague/high-risk signal → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        workItemType: 'bug',
        hasVagueOrHighRisk: true,
      });
      expect(route.tier).toBe('T3');
    });

    it('sensitive path → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        workItemType: 'bug',
        hasSensitivePath: true,
      });
      expect(route.tier).toBe('T3');
    });

    it('schema AND dependency signal → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasSchemaSignal: true,
        hasDependencySignal: true,
      });
      expect(route.tier).toBe('T3');
    });

    it('schema signal only → T2', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasSchemaSignal: true,
        hasDependencySignal: false,
      });
      expect(route.tier).toBe('T2');
    });

    it('dependency signal only → T2', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasSchemaSignal: false,
        hasDependencySignal: true,
      });
      expect(route.tier).toBe('T2');
    });

    it('bug + seed ≤3 files → T1', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        workItemType: 'bug',
        seedFileCount: 3,
        hasVagueOrHighRisk: false,
        hasSensitivePath: false,
        hasSchemaSignal: false,
        hasDependencySignal: false,
      });
      expect(route.tier).toBe('T1');
    });

    it('bug + no seed → T2 fail-safe', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        workItemType: 'bug',
        seedFileCount: null,
        hasVagueOrHighRisk: false,
        hasSensitivePath: false,
        hasSchemaSignal: false,
        hasDependencySignal: false,
      });
      expect(route.tier).toBe('T2');
    });
  });

  describe('confirmed tier (post-investigation)', () => {
    it('low confidence → T3 + requiresHumanApproval', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'low',
      });
      expect(route.tier).toBe('T3');
      expect(route.requiresHumanApproval).toBe(true);
      expect(route.escalationTriggers.some((t) => t.kind === 'low-confidence-investigation')).toBe(
        true,
      );
    });

    it('contradictions → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'high',
        hasContradictions: true,
        nonTestFileCount: 1,
      });
      expect(route.tier).toBe('T3');
    });

    it('sensitive path in investigation → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'high',
        hasSensitivePath: true,
        nonTestFileCount: 1,
        hasContradictions: false,
      });
      expect(route.tier).toBe('T3');
    });

    it('nonTestFiles ≥ 4 → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'medium',
        nonTestFileCount: 4,
        hasContradictions: false,
      });
      expect(route.tier).toBe('T3');
    });

    it('wave2 triggered → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'medium',
        wave2Triggered: true,
        nonTestFileCount: 1,
        hasContradictions: false,
      });
      expect(route.tier).toBe('T3');
    });

    it('nonTestFiles ≥ 2 → T2', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'medium',
        nonTestFileCount: 2,
        hasContradictions: false,
        hasSensitivePath: false,
        wave2Triggered: false,
      });
      expect(route.tier).toBe('T2');
    });

    it('high confidence + ≤1 non-test file → T1', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        investigationConfidence: 'high',
        nonTestFileCount: 0,
        hasContradictions: false,
        hasSensitivePath: false,
        wave2Triggered: false,
      });
      expect(route.tier).toBe('T1');
    });
  });

  describe('monotonic: finalTier = max(preliminary, confirmed)', () => {
    it('preliminary T3 is never downgraded by confirmed T1', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasVagueOrHighRisk: true,
        investigationConfidence: 'high',
        nonTestFileCount: 0,
        hasContradictions: false,
        hasSensitivePath: false,
        wave2Triggered: false,
      });
      expect(route.tier).toBe('T3');
    });

    it('preliminary T2 + confirmed T3 → T3', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasSchemaSignal: true,
        hasDependencySignal: false,
        investigationConfidence: 'low',
        nonTestFileCount: 1,
        hasContradictions: false,
        hasSensitivePath: false,
        wave2Triggered: false,
      });
      expect(route.tier).toBe('T3');
    });
  });

  describe('T3 budget caps and stages', () => {
    it('T3 has maxUsd=6, maxScouts=6, allowWave2=true, reviewerSlots=2', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasVagueOrHighRisk: true,
      });
      expect(route.tier).toBe('T3');
      expect(route.budgetCaps.maxUsd).toBe(6.0);
      expect(route.budgetCaps.maxScouts).toBe(6);
      expect(route.budgetCaps.allowWave2).toBe(true);
      expect(route.budgetCaps.reviewerSlots).toBe(2);
      expect(route.selectedStages).toContain('parallel-implement');
    });
  });

  describe('T2 budget caps', () => {
    it('T2 has maxUsd=2, maxScouts=3, allowWave2=false, reviewerSlots=1', () => {
      const route = selectWorkflowRoute({
        workItemId: 'test:1',
        hasSchemaSignal: true,
        hasDependencySignal: false,
      });
      expect(route.tier).toBe('T2');
      expect(route.budgetCaps.maxUsd).toBe(2.0);
      expect(route.budgetCaps.maxScouts).toBe(3);
      expect(route.budgetCaps.allowWave2).toBe(false);
      expect(route.budgetCaps.reviewerSlots).toBe(1);
      expect(route.selectedStages).toContain('spec-author');
      expect(route.selectedStages).not.toContain('parallel-implement');
    });
  });
});
