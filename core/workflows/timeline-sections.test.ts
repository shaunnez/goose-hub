import { describe, expect, it } from 'vitest';
import { ISSUE_TIMELINE_EVENT_KINDS } from '../event-stream/issue-timeline.js';
import {
  TIMELINE_EVENT_CLASSIFICATION,
  TIMELINE_SECTION_DEFINITIONS,
  buildTimelineRunMetadataIndex,
  resolveTimelineSection,
  resolveTimelineSectionFromEvents,
  timelineSectionForSkill,
} from './timeline-sections.js';

describe('timeline sections', () => {
  it('defines the canonical operator-facing section order', () => {
    expect(TIMELINE_SECTION_DEFINITIONS.map((section) => section.id)).toEqual([
      'triage',
      'investigation',
      'grill',
      'prd',
      'decompose',
      'delivery-router',
      'implementation',
      'dev-review',
      'qa',
      'review',
      'conflict',
      'retro',
      'transitions',
      'system',
    ]);
  });

  it('resolves runtime events from workflow-map skill ownership', () => {
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'grill-me' } }),
    ).toBe('grill');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'write-prd' } }),
    ).toBe('prd');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'decompose-issues' } }),
    ).toBe('decompose');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'spec-author' } }),
    ).toBe('delivery-router');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'implement-wp' } }),
    ).toBe('implementation');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'resolve-conflict' } }),
    ).toBe('conflict');
  });

  it('falls through display aliases to the durable runtime skill for section ownership', () => {
    expect(
      resolveTimelineSection({
        kind: 'agent.run-started',
        payload: {
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
          skill: 'implement',
        },
      }),
    ).toBe('implementation');
  });

  it('uses earlier run metadata when completion events are incomplete', () => {
    const events = [
      { kind: 'agent.run-completed', runId: 'discover-1' },
      { kind: 'agent.log', runId: 'discover-1', payload: { stream: 'stdout', line: 'working' } },
      { kind: 'agent.tool-call', runId: 'discover-1' },
      { kind: 'agent.run-failed', runId: 'discover-1' },
      { kind: 'agent.budget-exceeded', runId: 'discover-1' },
      { kind: 'agent.output-repair-failed', runId: 'discover-1' },
      { kind: 'agent.run-started', runId: 'discover-1', payload: { skill: 'grill-me' } },
    ];
    const metadata = buildTimelineRunMetadataIndex(events);

    expect(resolveTimelineSectionFromEvents(events)).toBe('grill');
    for (const event of events.slice(0, -1)) {
      expect(resolveTimelineSection(event, { runMetadata: metadata })).toBe('grill');
    }
  });

  it('maps control flow to transitions and unknown telemetry to system', () => {
    expect(resolveTimelineSection({ kind: 'state.transitioned' })).toBe('transitions');
    expect(resolveTimelineSection({ kind: 'manual.action' })).toBe('transitions');
    expect(resolveTimelineSection({ kind: 'unknown.future-event' })).toBe('system');
  });

  it('keeps historical run id parsing isolated as a compatibility fallback', () => {
    expect(
      resolveTimelineSection({ kind: 'agent.run-completed', runId: 'discover-1:write-prd' }),
    ).toBe('prd');
    expect(
      resolveTimelineSection({
        kind: 'agent.run-completed',
        runId: 'discover-1:write-prd',
        payload: { skill: 'grill-me' },
      }),
    ).toBe('grill');
  });

  it('makes every visible issue timeline event an explicit classification decision', () => {
    const allowed = new Set([
      'direct',
      'runtime-inherits',
      'intentionally-system',
      'hidden',
    ] as const);

    for (const kind of ISSUE_TIMELINE_EVENT_KINDS) {
      const decision = TIMELINE_EVENT_CLASSIFICATION[kind];
      expect(decision, `${kind} classification`).toBeDefined();
      if (decision == null) throw new Error(`${kind} classification missing`);
      expect(allowed.has(decision), `${kind} decision kind`).toBe(true);
      expect(decision, `${kind} must not be hidden while visible`).not.toBe('hidden');
    }
  });

  it('keeps skill identity separate from timeline section identity', () => {
    expect(timelineSectionForSkill('write-prd')).toBe('prd');
    expect(timelineSectionForSkill('advise-on-prd')).toBe('prd');
    expect(timelineSectionForSkill('prd')).toBeNull();
  });
});
