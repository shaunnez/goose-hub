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
      'grounding',
      'investigation',
      'grill',
      'prd',
      'decompose',
      'delivery-router',
      'implementation',
      'evidence',
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
      resolveTimelineSection({
        kind: 'agent.run-completed',
        payload: { skill: 'parallel-implement' },
      }),
    ).toBe('implementation');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'resolve-conflict' } }),
    ).toBe('conflict');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'bug-enhance' } }),
    ).toBe('investigation');
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

  it('uses earlier run metadata for tool violations', () => {
    const events = [
      { kind: 'tool.violation', runId: 'fix-feedback-run' },
      {
        kind: 'agent.run-started',
        runId: 'fix-feedback-run',
        payload: {
          skill: 'implement',
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
      },
    ];
    const metadata = buildTimelineRunMetadataIndex(events);

    expect(resolveTimelineSection(events[0], { runMetadata: metadata })).toBe('implementation');
    expect(TIMELINE_EVENT_CLASSIFICATION['tool.violation']).toBe('runtime-inherits');
  });

  it('routes lazy bug-enhance runtime events to investigation', () => {
    const events = [
      { kind: 'agent.tool-call', runId: 'bug-enhance-run' },
      {
        kind: 'agent.run-started',
        runId: 'bug-enhance-run',
        payload: { skill: 'bug-enhance' },
      },
      { kind: 'agent.run-completed', runId: 'bug-enhance-run' },
    ];
    const metadata = buildTimelineRunMetadataIndex(events);

    for (const event of events) {
      expect(resolveTimelineSection(event, { runMetadata: metadata })).toBe('investigation');
    }

    expect(
      resolveTimelineSection({ kind: 'agent.tool-call', runId: 'investigate-1:bug-enhance' }),
    ).toBe('investigation');
  });

  it('maps control flow to transitions and unknown telemetry to system', () => {
    expect(resolveTimelineSection({ kind: 'state.transitioned' })).toBe('transitions');
    expect(resolveTimelineSection({ kind: 'manual.action' })).toBe('transitions');
    expect(resolveTimelineSection({ kind: 'unknown.future-event' })).toBe('system');
  });

  it('routes investigation digest events to the investigation section', () => {
    expect(resolveTimelineSection({ kind: 'investigation.digest-applied' })).toBe('investigation');
  });

  it('routes post-implementation evidence events to Evidence instead of Dev Review', () => {
    expect(resolveTimelineSection({ kind: 'evidence.no-spec-declared' })).toBe('evidence');
    expect(resolveTimelineSection({ kind: 'evidence.posted' })).toBe('evidence');
    expect(
      resolveTimelineSection({ kind: 'agent.run-started', payload: { skill: 'evidence-post' } }),
    ).toBe('evidence');
    expect(resolveTimelineSection({ kind: 'dev-review.completed' })).toBe('dev-review');
  });

  it('routes WS3 and dogfood observability events explicitly', () => {
    expect(resolveTimelineSection({ kind: 'dogfood.seed-applied' })).toBe('system');
    expect(resolveTimelineSection({ kind: 'parallel-implement.wp-persisted' })).toBe(
      'implementation',
    );
    expect(TIMELINE_EVENT_CLASSIFICATION['dogfood.seed-applied']).toBe('direct');
    expect(TIMELINE_EVENT_CLASSIFICATION['parallel-implement.wp-persisted']).toBe('direct');
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
    expect(timelineSectionForSkill('feature-grounding')).toBe('grounding');
    expect(timelineSectionForSkill('bug-enhance')).toBe('investigation');
    expect(timelineSectionForSkill('parallel-implement')).toBe('implementation');
    expect(timelineSectionForSkill('evidence-post')).toBe('evidence');
    expect(timelineSectionForSkill('prd')).toBeNull();
  });
});
