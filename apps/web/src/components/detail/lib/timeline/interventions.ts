import type { InterventionTimelineDetail, RenderItem } from './types';

export const VISIBLE_INTERVENTION_EVENT_TYPES = new Set([
  'open',
  'propose',
  'proposalFailed',
  'decide',
  'markApplying',
  'recordApplicationResult',
  'verify',
  'resolve',
  'reopen',
  'abort',
  'supersede',
  'applyLeaseRecovered',
]);

const CLOSED_INTERVENTION_STATUSES = new Set(['RESOLVED', 'ABORTED', 'SUPERSEDED']);

export function buildInterventionGroup(detail: InterventionTimelineDetail): RenderItem {
  const events = detail.events
    .filter((event) => VISIBLE_INTERVENTION_EVENT_TYPES.has(event.eventType))
    .sort((a, b) => {
      const timestampDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return timestampDelta === 0 ? a.id - b.id : timestampDelta;
    });
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  return {
    kind: 'intervention-group',
    intervention: detail.intervention,
    events,
    startedAt: firstEvent?.createdAt ?? detail.intervention.createdAt,
    lastEventAt: lastEvent?.createdAt ?? detail.intervention.updatedAt,
    endedAt:
      CLOSED_INTERVENTION_STATUSES.has(detail.intervention.status) &&
      detail.intervention.resolvedAt != null
        ? detail.intervention.resolvedAt
        : null,
  };
}
