import { decideIntervention, fetchIssueInterventions, fetchLegalTargets } from '@/lib/api';
import { cn } from '@/lib/cn';
import { interventionKeys, invalidateInterventionDecision } from '@/lib/query-keys';
import type { InterventionDto, InterventionOptionDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const ACTIVE_INTERVENTION_STATUSES = ['OPEN', 'PROPOSED'] as const;

function interventionVariant(
  interventionType: InterventionDto['interventionType'],
): 'danger' | 'warning' | 'info' {
  if (interventionType === 'needs_human') return 'danger';
  if (interventionType === 'gate_pending') return 'info';
  return 'warning';
}

function selectPrimaryIntervention(interventions: InterventionDto[]): InterventionDto | undefined {
  return (
    interventions.find((intervention) => intervention.status === 'PROPOSED') ??
    interventions.find((intervention) => intervention.status === 'OPEN')
  );
}

function buttonTone(actionType: string): 'danger' | 'warning' | 'accent' | 'info' {
  if (actionType === 'reject_gate') return 'danger';
  if (actionType === 'resolve_conflict') return 'warning';
  if (actionType === 'no_action') return 'info';
  return 'accent';
}

function targetLabel(target: string): string {
  return target.replace(/^factory:/, '').replace(/-/g, ' ');
}

interface GatePendingBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
  onTransitioned?: () => void;
}

export function GatePendingBanner({ projectSlug, id, onTransitioned }: GatePendingBannerProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: interventions = [] } = useQuery({
    queryKey:
      projectSlug && id
        ? interventionKeys.issue(projectSlug, id, [...ACTIVE_INTERVENTION_STATUSES])
        : ['interventions', 'issue', 'missing'],
    queryFn: () =>
      fetchIssueInterventions(projectSlug ?? '', id ?? '', [...ACTIVE_INTERVENTION_STATUSES]),
    enabled: !!projectSlug && !!id,
  });

  const primary = selectPrimaryIntervention(interventions);
  const shouldFetchLegalTargets = primary?.status === 'OPEN' && !!projectSlug && !!id;

  const { data: legalTargets } = useQuery({
    queryKey:
      projectSlug && id
        ? interventionKeys.legalTargets(projectSlug, id)
        : ['legal-targets', 'missing'],
    queryFn: () => fetchLegalTargets(projectSlug ?? '', id ?? ''),
    enabled: shouldFetchLegalTargets,
  });

  if (!primary || !projectSlug || !id) return null;

  const variant = interventionVariant(primary.interventionType);
  const showGrillLink = primary.interventionType === 'gate_pending';
  const options = primary.status === 'PROPOSED' ? primary.proposedOptions : [];
  const manualTargets =
    primary.status === 'OPEN' && legalTargets != null ? legalTargets.legalTargets : [];

  const handleDecision = async (
    intervention: InterventionDto,
    actionType: string,
    actionPayload: unknown,
    reason?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await decideIntervention(intervention.id, {
        actionType,
        actionPayload,
        expectedVersion: intervention.version,
        decidedBy: 'operator',
        reason,
      });
      await invalidateInterventionDecision(queryClient, {
        projectSlug,
        issueId: id,
        interventionId: intervention.id,
      });
      onTransitioned?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const renderOption = (option: InterventionOptionDto, index: number) => {
    const tone = buttonTone(option.actionType);
    return (
      <button
        key={`${option.actionType}-${index}`}
        type="button"
        disabled={busy}
        title={option.description}
        data-testid={`gate-action-option-${index}`}
        onClick={() =>
          void handleDecision(primary, option.actionType, option.payload, option.description)
        }
        className={cn(
          'h-6 px-2.5 rounded text-[11.5px] font-medium border capitalize',
          tone === 'danger' &&
            'border-[color:var(--danger)]/60 text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20',
          tone === 'warning' &&
            'border-[color:var(--warning)]/60 text-[color:var(--warning)] hover:bg-[color:var(--warning)]/20',
          tone === 'accent' &&
            'border-[color:var(--accent)]/60 text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20',
          tone === 'info' &&
            'border-[color:var(--info)]/60 text-[color:var(--info)] hover:bg-[color:var(--info)]/20',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {option.label}
      </button>
    );
  };

  return (
    <div
      data-testid="gate-pending-banner"
      data-variant={variant}
      className={cn(
        'flex flex-col px-6 py-2.5 shrink-0',
        'border-b',
        'text-[12.5px] font-medium',
        variant === 'danger' &&
          'border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 text-[color:var(--danger)]',
        variant === 'warning' &&
          'border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
        variant === 'info' &&
          'border-[color:var(--info)]/40 bg-[color:var(--info)]/10 text-[color:var(--info)]',
      )}
    >
      <div className="flex items-center gap-2.5">
        {variant === 'info' ? (
          <Info size={14} className="shrink-0" />
        ) : (
          <ShieldAlert size={14} className="shrink-0" />
        )}
        <span>{primary.title}</span>
        {primary.status === 'OPEN' && (
          <span className="text-[11.5px] opacity-70">
            {primary.leaseOwner ? 'Proposal running' : 'Proposal pending'}
          </span>
        )}
        {error && <span className="text-[color:var(--danger)] ml-2">{error}</span>}
        <span className="grow" />
        <span className="flex items-center gap-2">
          {showGrillLink && (
            <Link
              to={`/projects/${projectSlug}/items/${id}/grill`}
              data-testid="gate-action-grill"
              className={cn(
                'flex items-center gap-1 h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--info)]/60 text-[color:var(--info)]',
                'hover:bg-[color:var(--info)]/20',
              )}
            >
              <MessageCircleQuestion size={12} />
              Grill
            </Link>
          )}
          {options.map(renderOption)}
          {manualTargets.map((target) => (
            <button
              key={target}
              type="button"
              disabled={busy}
              data-testid={`gate-action-manual-${target.replace(/[^a-z0-9]+/gi, '-')}`}
              onClick={() =>
                void handleDecision(
                  primary,
                  'manual_transition',
                  {
                    from: legalTargets?.from,
                    to: target,
                    reason: 'operator selected legal target',
                  },
                  'manual fallback from intervention banner',
                )
              }
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border capitalize',
                'border-[color:var(--accent)]/60 text-[color:var(--accent)]',
                'hover:bg-[color:var(--accent)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {targetLabel(target)}
            </button>
          ))}
        </span>
      </div>
      <p
        data-testid="escalation-reason"
        className="mt-1 pl-[22px] text-[11.5px] opacity-70 italic font-normal truncate"
      >
        {primary.reason}
      </p>
    </div>
  );
}
