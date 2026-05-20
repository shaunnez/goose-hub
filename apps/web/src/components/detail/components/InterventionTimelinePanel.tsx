import { fetchIntervention, fetchIssueInterventions } from '@/lib/api';
import type { InterventionDetailDto, InterventionEventDto } from '@/lib/api/interventions';
import { interventionKeys } from '@/lib/query-keys';
import type { InterventionDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, RotateCcw } from 'lucide-react';

interface InterventionTimelinePanelProps {
  projectSlug: string;
  id: string;
}

const VISIBLE_EVENT_TYPES = new Set([
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

const EVENT_LABELS: Record<string, string> = {
  open: 'Opened',
  propose: 'Proposed',
  proposalFailed: 'Proposal failed',
  decide: 'Decided',
  markApplying: 'Applying',
  recordApplicationResult: 'Applied',
  verify: 'Verified',
  resolve: 'Resolved',
  reopen: 'Reopened',
  abort: 'Aborted',
  supersede: 'Superseded',
  applyLeaseRecovered: 'Apply lease recovered',
};

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function formatAction(value: string | null): string {
  if (value == null) return 'No action recorded';
  return value.replace(/_/g, ' ');
}

function payloadSummary(event: InterventionEventDto, intervention: InterventionDto): string {
  const payload = event.payload as Record<string, unknown> | null;
  if (event.eventType === 'decide') {
    const actionType =
      typeof payload?.actionType === 'string' ? payload.actionType : intervention.decidedActionType;
    return `${event.actor} chose ${formatAction(actionType)}`;
  }
  if (event.eventType === 'proposalFailed') {
    return typeof payload?.error === 'string' ? payload.error : 'Proposal failed';
  }
  if (event.eventType === 'recordApplicationResult') {
    return event.toStatus === 'FAILED' ? 'Apply failed' : 'Apply completed';
  }
  if (event.eventType === 'reopen') {
    return typeof payload?.reason === 'string' ? payload.reason : intervention.reason;
  }
  return event.toStatus != null ? `${event.fromStatus ?? 'new'} -> ${event.toStatus}` : event.actor;
}

function statusIcon(status: InterventionDto['status']) {
  if (status === 'FAILED') return AlertTriangle;
  if (status === 'RESOLVED' || status === 'VERIFIED' || status === 'APPLIED') return CheckCircle2;
  if (status === 'OPEN') return RotateCcw;
  return ClipboardList;
}

export function InterventionTimelinePanel({ projectSlug, id }: InterventionTimelinePanelProps) {
  const { data: details = [] } = useQuery({
    queryKey: interventionKeys.timeline(projectSlug, id),
    queryFn: async (): Promise<InterventionDetailDto[]> => {
      const interventions = await fetchIssueInterventions(projectSlug, id);
      return Promise.all(interventions.map((intervention) => fetchIntervention(intervention.id)));
    },
  });

  if (details.length === 0) return null;

  return (
    <section data-testid="intervention-timeline-panel" className="mb-5">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-2">
        Intervention audit
      </div>
      <div className="flex flex-col gap-3">
        {details.map(({ intervention, events }) => {
          const Icon = statusIcon(intervention.status);
          const visibleEvents = events.filter((event) => VISIBLE_EVENT_TYPES.has(event.eventType));
          return (
            <article
              key={intervention.id}
              data-testid={`intervention-card-${intervention.id}`}
              className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
                <Icon size={13} className="shrink-0" />
                <span className="font-mono uppercase tracking-wider">
                  {intervention.interventionType.replace(/_/g, ' ')}
                </span>
                <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
                <span className="font-mono">{intervention.status}</span>
                <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
                <span className="font-mono">#{shortId(intervention.id)}</span>
              </div>
              <div className="mt-2 text-[13px] font-medium text-fg">{intervention.title}</div>
              <div className="mt-1 text-[12px] text-fg-2">{intervention.reason}</div>
              {visibleEvents.length > 0 && (
                <ol className="mt-3 flex flex-col gap-1.5 border-l border-line pl-3">
                  {visibleEvents.map((event) => (
                    <li
                      key={event.id}
                      data-testid={`intervention-event-${event.eventType}`}
                      className="text-[12px] text-fg-2"
                    >
                      <span className="font-mono uppercase text-[10.5px] text-fg-3">
                        {EVENT_LABELS[event.eventType] ?? event.eventType}
                      </span>
                      <span className="text-fg-4 mx-1">·</span>
                      <span>{payloadSummary(event, intervention)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
