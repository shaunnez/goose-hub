import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock, GitPullRequest } from 'lucide-react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { type ReviewPayload, VERDICT_LABEL } from '../lib/review';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';
import { ChecklistRow } from './review/ChecklistRow';
import { FindingsList } from './review/FindingsList';
import { type PipelineStep, PreMergePipeline } from './review/PreMergePipeline';
import { VerdictPill } from './review/VerdictPill';

interface ReviewSectionProps {
  projectSlug: string;
  id: string;
}

export function ReviewSection({ projectSlug, id }: ReviewSectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });
  const { byStage } = useIssueCostsBreakdown(projectSlug, id);
  const reviewCost = byStage.get('review');
  if (isLoading) return null;

  const reviewEvent = [...events].find((e) => e.kind === 'review.completed');
  const review = reviewEvent?.payload as ReviewPayload | undefined;

  const prOpenedEvent = [...events]
    .reverse()
    .find(
      (e): e is AgentEventDto & { payload: { prNumber?: number; prUrl: string } } =>
        e.kind === 'pr.opened' && typeof (e.payload as Record<string, unknown>)?.prUrl === 'string',
    );
  const prUrl = prOpenedEvent?.payload.prUrl ?? null;
  const prNumber = prOpenedEvent?.payload.prNumber ?? null;

  if (!review) {
    return (
      <div className="px-8 py-6">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">08. Review</div>
        <h2 className="text-[17px] font-semibold text-fg leading-snug mb-5">Pre-merge checklist</h2>
        <SectionEmptyState
          data-testid="review-empty-state"
          icon={Clock}
          title="Waiting for Review to run…"
          subtitle="Review runs automatically after QA passes."
        />
      </div>
    );
  }

  const qaEvent = events.find((e) => e.kind === 'qa.completed');
  const qaPayload = qaEvent?.payload as
    | {
        tierResults?: {
          structural?: { passed: boolean };
          functional?: { passed: boolean };
        };
        testRun?: { failed: number };
        criteriaResults?: { passed: boolean }[];
      }
    | undefined;

  const pipeline: PipelineStep[] = [
    { label: 'Lint clean', passed: qaPayload?.tierResults?.structural?.passed },
    {
      label: 'Tests passing',
      passed:
        qaPayload?.testRun != null
          ? qaPayload.testRun.failed === 0
          : qaPayload?.tierResults?.functional?.passed,
    },
    {
      label: 'Acceptance criteria',
      passed:
        qaPayload?.criteriaResults != null && qaPayload.criteriaResults.length > 0
          ? qaPayload.criteriaResults.every((r) => r.passed)
          : undefined,
    },
    { label: 'PR opened', passed: prOpenedEvent != null },
    { label: 'Review approved', passed: review.verdict === 'approved' },
  ];

  const checks = review.criteriaChecks ?? [];
  const metCount = checks.filter((c) => c.status === 'met').length;
  const total = checks.length;

  const confidencePct = Math.round(review.confidence * 100);
  const verdictLabel = VERDICT_LABEL[review.verdict] ?? String(review.verdict ?? 'unknown');
  const hint =
    total > 0
      ? `${metCount} of ${total} checks pass · ${verdictLabel.toLowerCase()} · ${confidencePct}% confidence`
      : `${verdictLabel.toLowerCase()} · ${confidencePct}% confidence`;

  return (
    <div data-testid="review-section" className="px-8 py-6 flex flex-col gap-5  mx-auto">
      {/* Header */}
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">07. Review</div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">Pre-merge checklist</h2>
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3 mt-1 flex-wrap">
            <span>{hint}</span>
            {reviewCost && (
              <>
                <span className="text-fg-5">·</span>
                <CostBadge
                  tokens={reviewCost.tokens}
                  usd={reviewCost.usd}
                  label={reviewCost.label}
                  size="sm"
                />
              </>
            )}
          </div>
        </div>
        {prUrl && (
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="review-open-pr"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[color:var(--accent)] text-[color:var(--accent-fg)] text-[12px] font-medium hover:opacity-90"
            >
              <GitPullRequest size={12} />
              {prNumber != null ? `Open PR #${prNumber}` : 'Open PR'}
            </a>
          </div>
        )}
      </div>

      <VerdictPill verdict={review.verdict} confidence={review.confidence} />

      {review.escalationReason && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12.5px] text-fg-2">
          <span className="font-medium text-red-400">Escalation: </span>
          {review.escalationReason}
        </div>
      )}

      <PreMergePipeline pipeline={pipeline} />

      {total > 0 ? (
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          {checks.map((c, i) => (
            <ChecklistRow key={c.criterion} check={c} isFirst={i === 0} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-bg-elev p-6 text-center text-[12.5px] text-fg-3">
          No pre-merge checks recorded for this run.
        </div>
      )}

      <FindingsList findings={review.findings ?? []} />
    </div>
  );
}
