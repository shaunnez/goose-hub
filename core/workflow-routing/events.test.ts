import { db } from '@goose-hub/core/db/db.js';
import { events } from '@goose-hub/core/db/schema.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  emitCapApplied,
  emitEscalationProposed,
  emitRouteConfirmed,
  emitRouteSelected,
  loadLatestRoute,
} from './events.js';
import { selectWorkflowRoute } from './select-route.js';
import type { CapConflict } from './types.js';

const PROJECT = 'test-workflow-routing-events';
const WORK_ITEM_ID = 'github:test/repo#42';

function cleanup() {
  db.delete(events).where(sql`project_id = ${PROJECT}`).run();
}

beforeAll(cleanup);
afterEach(cleanup);
afterAll(cleanup);

describe('route events round-trip', () => {
  it('emitRouteSelected → loadLatestRoute returns same tier and source', () => {
    const route = selectWorkflowRoute(
      {
        workItemId: WORK_ITEM_ID,
        workItemType: 'bug',
        seedFileCount: 2,
        hasVagueOrHighRisk: false,
        hasSensitivePath: false,
        hasSchemaSignal: false,
        hasDependencySignal: false,
      },
      'promotion',
    );

    emitRouteSelected({ projectId: PROJECT, workItemId: WORK_ITEM_ID, route });

    const loaded = loadLatestRoute({ projectId: PROJECT, workItemId: WORK_ITEM_ID });
    expect(loaded).not.toBeNull();
    expect(loaded?.tier).toBe(route.tier);
    expect(loaded?.source).toBe('promotion');
    expect(loaded?.budgetCaps.maxUsd).toBe(route.budgetCaps.maxUsd);
  });

  it('route-confirmed supersedes route-selected when both exist at the same tier', () => {
    const preliminary = selectWorkflowRoute(
      {
        workItemId: WORK_ITEM_ID,
        workItemType: 'bug',
        seedFileCount: 2,
        hasVagueOrHighRisk: false,
        hasSensitivePath: false,
        hasSchemaSignal: false,
        hasDependencySignal: false,
      },
      'promotion',
    );
    emitRouteSelected({ projectId: PROJECT, workItemId: WORK_ITEM_ID, route: preliminary });

    const confirmed = selectWorkflowRoute(
      {
        workItemId: WORK_ITEM_ID,
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
      },
      'investigation',
    );
    emitRouteConfirmed({ projectId: PROJECT, workItemId: WORK_ITEM_ID, route: confirmed });

    const loaded = loadLatestRoute({ projectId: PROJECT, workItemId: WORK_ITEM_ID });
    expect(loaded?.source).toBe('investigation');
    expect(loaded?.tier).toBe('T1');
  });

  it('loadLatestRoute preserves a higher selected route after lower confirmation', () => {
    const preliminary = selectWorkflowRoute(
      {
        workItemId: WORK_ITEM_ID,
        workItemType: 'bug',
        seedFileCount: 1,
        hasVagueOrHighRisk: false,
        hasSensitivePath: true,
        hasSchemaSignal: false,
        hasDependencySignal: false,
      },
      'lazy-enhance',
    );
    emitRouteSelected({ projectId: PROJECT, workItemId: WORK_ITEM_ID, route: preliminary });

    const confirmed = selectWorkflowRoute(
      {
        workItemId: WORK_ITEM_ID,
        workItemType: 'bug',
        seedFileCount: null,
        hasVagueOrHighRisk: false,
        hasSensitivePath: false,
        hasSchemaSignal: false,
        hasDependencySignal: false,
        investigationConfidence: 'high',
        nonTestFileCount: 1,
        hasContradictions: false,
        wave2Triggered: false,
      },
      'investigation',
    );
    emitRouteConfirmed({ projectId: PROJECT, workItemId: WORK_ITEM_ID, route: confirmed });

    const loaded = loadLatestRoute({ projectId: PROJECT, workItemId: WORK_ITEM_ID });
    expect(loaded?.source).toBe('lazy-enhance');
    expect(loaded?.tier).toBe('T3');
  });

  it('loadLatestRoute returns null when no events exist', () => {
    const result = loadLatestRoute({ projectId: PROJECT, workItemId: 'github:test/repo#999' });
    expect(result).toBeNull();
  });

  it('emitCapApplied records cap-applied event', () => {
    const conflict: CapConflict = {
      requiredTier: 'T3',
      effectiveTier: 'T2',
      cappedBy: 'useInvestigationSwarm',
      reason: 'flag cap limits investigation',
      hasSensitivePath: false,
    };
    emitCapApplied({ projectId: PROJECT, workItemId: WORK_ITEM_ID, conflict });

    const capEvents = eventStore.replay({
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      kind: 'workflow.route-cap-applied',
    });
    expect(capEvents).toHaveLength(1);
    expect((capEvents[0].payload as { requiredTier: string }).requiredTier).toBe('T3');
    expect((capEvents[0].payload as { effectiveTier: string }).effectiveTier).toBe('T2');
  });

  it('emitEscalationProposed records escalation-proposed event', () => {
    const route = selectWorkflowRoute(
      { workItemId: WORK_ITEM_ID, investigationConfidence: 'low' },
      'investigation',
    );
    emitEscalationProposed({
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      route,
      interventionId: 'test-intervention-id',
    });

    const escalationEvents = eventStore.replay({
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      kind: 'workflow.route-escalation-proposed',
    });
    expect(escalationEvents).toHaveLength(1);
    expect((escalationEvents[0].payload as { interventionId: string }).interventionId).toBe(
      'test-intervention-id',
    );
  });
});
