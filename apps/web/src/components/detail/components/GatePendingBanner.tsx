import { decideIntervention, fetchIssueInterventions, fetchLegalTargets } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GATE_STATES } from '@/lib/constants';
import { interventionKeys, invalidateInterventionDecision } from '@/lib/query-keys';
import type { InterventionDto, InterventionOptionDto } from '@/lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const ACTIVE_INTERVENTION_STATUSES = ['OPEN', 'PROPOSED'] as const;
const OPEN_INTERVENTION_REFETCH_MS = 3_000;

function interventionVariant(
  interventionType: InterventionDto['interventionType'],
): 'danger' | 'warning' | 'info' {
  if (interventionType === 'needs_human') return 'danger';
  if (interventionType === 'gate_pending') return 'info';
  if (interventionType === 'prd_review') return 'info';
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

function isVersionConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('409') && err.message.includes('Conflict');
}

interface GatePendingBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
  onTransitioned?: () => void;
}

export function GatePendingBanner({
  state,
  projectSlug,
  id,
  onTransitioned,
}: GatePendingBannerProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGateState = state != null && GATE_STATES[state] != null;

  const interventionsQuery = useQuery({
    queryKey:
      projectSlug && id
        ? [...interventionKeys.issue(projectSlug, id, [...ACTIVE_INTERVENTION_STATUSES]), state]
        : ['interventions', 'issue', 'missing'],
    queryFn: () =>
      fetchIssueInterventions(projectSlug ?? '', id ?? '', [...ACTIVE_INTERVENTION_STATUSES]),
    enabled: isGateState && !!projectSlug && !!id,
  });

  const interventions = interventionsQuery.data ?? [];
  const primary = selectPrimaryIntervention(interventions);
  const isPrdReviewIntervention = primary?.interventionType === 'prd_review';
  const shouldFetchLegalTargets =
    isGateState && !isPrdReviewIntervention && primary?.status === 'OPEN' && !!projectSlug && !!id;

  const { data: legalTargets } = useQuery({
    queryKey:
      projectSlug && id
        ? [...interventionKeys.legalTargets(projectSlug, id), state]
        : ['legal-targets', 'missing'],
    queryFn: () => fetchLegalTargets(projectSlug ?? '', id ?? ''),
    enabled: shouldFetchLegalTargets,
  });

  useEffect(() => {
    if (!isGateState || primary?.status !== 'OPEN') return;
    const interval = setInterval(() => {
      void interventionsQuery.refetch();
    }, OPEN_INTERVENTION_REFETCH_MS);
    return () => clearInterval(interval);
  }, [isGateState, primary?.status, interventionsQuery.refetch]);

  if (!isGateState || !primary || !projectSlug || !id) return null;

  const variant = interventionVariant(primary.interventionType);
  const options =
    primary.status === 'PROPOSED' && !isPrdReviewIntervention ? primary.proposedOptions : [];
  const manualTargets =
    !isPrdReviewIntervention && primary.status === 'OPEN' && legalTargets != null
      ? legalTargets.legalTargets
      : [];

  const handleDecision = async (
    intervention: InterventionDto,
    actionType: string,
    actionPayload: unknown,
    reason?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const refreshed = await interventionsQuery.refetch();
      if (refreshed.error != null) throw refreshed.error;
      const freshPrimary = selectPrimaryIntervention(refreshed.data ?? []);
      if (
        freshPrimary == null ||
        freshPrimary.id !== intervention.id ||
        freshPrimary.version !== intervention.version ||
        freshPrimary.status !== intervention.status
      ) {
        return;
      }
      await decideIntervention(freshPrimary.id, {
        actionType,
        actionPayload,
        expectedVersion: freshPrimary.version,
        decidedBy: 'operator',
        reason,
      });
      await invalidateInterventionDecision(queryClient, {
        projectSlug,
        issueId: id,
        interventionId: freshPrimary.id,
      });
      onTransitioned?.();
    } catch (err) {
      if (isVersionConflict(err)) {
        await interventionsQuery.refetch();
        await queryClient.invalidateQueries({
          queryKey: interventionKeys.legalTargets(projectSlug, id),
        });
        return;
      }
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
        {!isPrdReviewIntervention && primary.status === 'OPEN' && (
          <span className="text-[11.5px] opacity-70">
            {primary.leaseOwner ? 'Proposal running' : 'Proposal pending'}
          </span>
        )}
        {error && <span className="text-[color:var(--danger)] ml-2">{error}</span>}
        <span className="grow" />
        <span className="flex items-center gap-2">
          {isPrdReviewIntervention && (
            <Link
              to={`/projects/${projectSlug}/items/${id}/prd`}
              data-testid="gate-action-review-prd"
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--info)]/60 text-[color:var(--info)]',
                'hover:bg-[color:var(--info)]/20',
              )}
            >
              Review PRD
            </Link>
          )}
          {options.map(renderOption)}
          {manualTargets.map((target) => (
            <button
              key={target}
              type="button"
              disabled={busy}
              data-testid={
                target === 'factory:needs-qa'
                  ? 'gate-action-send-to-qa'
                  : `gate-action-manual-${target.replace(/[^a-z0-9]+/gi, '-')}`
              }
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
