import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle, Clock, GitPullRequest, XCircle } from 'lucide-react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';

interface ReviewSectionProps {
  projectSlug: string;
  id: string;
}

interface CriterionCheck {
  criterion: string;
  status: 'met' | 'unmet' | 'unclear';
  notes?: string;
}

type ReviewDisposition = 'fixed' | 'registered' | 'out-of-scope';

interface ReviewFinding {
  criterion?: string;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  suggestion?: string;
  file?: string;
  line?: number;
  disposition?: ReviewDisposition;
  dispositionRef?: string;
}

const DISPOSITION_COLOR: Record<ReviewDisposition, string> = {
  fixed: 'bg-green-500/15 text-green-400',
  registered: 'bg-sky-500/15 text-sky-400',
  'out-of-scope': 'bg-gray-500/15 text-gray-400',
};

function formatDisposition(d: ReviewDisposition, ref?: string): string {
  if (d === 'fixed') return 'fixed';
  if (d === 'out-of-scope') return 'out-of-scope';
  return ref != null && ref.length > 0
    ? `registered ${ref.startsWith('#') ? ref : `#${ref}`}`
    : 'registered';
}

type ReviewVerdict = 'approved' | 'needs-fix' | 'needs-human';

interface ReviewPayload {
  verdict: ReviewVerdict;
  confidence: number;
  criteriaChecks: CriterionCheck[];
  findings: ReviewFinding[];
  escalationReason?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  blocker: 'bg-red-500/15 text-red-400',
  major: 'bg-orange-500/15 text-orange-400',
  minor: 'bg-gray-500/15 text-gray-400',
};

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'Approved',
  'needs-fix': 'Needs fix',
  'needs-human': 'Needs human',
};

function ChecklistRow({ check, isFirst }: { check: CriterionCheck; isFirst: boolean }) {
  const met = check.status === 'met';
  const unclear = check.status === 'unclear';
  const textColor = met ? 'text-fg' : unclear ? 'text-fg-2' : 'text-fg-3';

  return (
    <div
      data-testid="review-checklist-row"
      data-status={check.status}
      className={`flex items-center gap-3 px-4 py-3 ${isFirst ? '' : 'border-t border-line'}`}
    >
      <span
        aria-hidden
        className={`grid place-items-center shrink-0 rounded-full ${
          met
            ? 'bg-[color:var(--success)]'
            : unclear
              ? 'border-[1.5px] border-dashed border-yellow-500/60'
              : 'border-[1.5px] border-dashed border-line-2'
        }`}
        style={{ width: 22, height: 22 }}
      >
        {met && <Check size={12} strokeWidth={2.4} className="text-[color:var(--bg)]" />}
        {check.status === 'unmet' && (
          <XCircle size={12} className="text-red-400/70" strokeWidth={2} />
        )}
        {unclear && <AlertTriangle size={11} className="text-yellow-500/80" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] ${textColor}`}>{check.criterion}</div>
        {check.notes && <div className="text-[11.5px] text-fg-3 mt-0.5">{check.notes}</div>}
      </div>
    </div>
  );
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
        <SectionEmptyState
          data-testid="review-empty-state"
          icon={Clock}
          title="Waiting for Review to run…"
          subtitle="Review runs automatically after QA passes."
        />
      </div>
    );
  }

  const checks = review.criteriaChecks ?? [];
  const metCount = checks.filter((c) => c.status === 'met').length;
  const total = checks.length;

  const VerdictIcon =
    review.verdict === 'approved'
      ? CheckCircle
      : review.verdict === 'needs-fix'
        ? XCircle
        : AlertTriangle;
  const verdictColor =
    review.verdict === 'approved'
      ? 'text-[color:var(--success)]'
      : review.verdict === 'needs-fix'
        ? 'text-orange-500'
        : 'text-red-500';

  const confidencePct = Math.round(review.confidence * 100);
  const verdictLabel = VERDICT_LABEL[review.verdict] ?? String(review.verdict ?? 'unknown');
  const hint =
    total > 0
      ? `${metCount} of ${total} checks pass · ${verdictLabel.toLowerCase()} · ${confidencePct}% confidence`
      : `${verdictLabel.toLowerCase()} · ${confidencePct}% confidence`;

  return (
    <div data-testid="review-section" className="px-7 py-6 flex flex-col gap-5  mx-auto">
      {/* Header */}
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">07. Review</div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Pre-merge checklist
          </h2>
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

      {/* Verdict pill */}
      <div className="flex items-center gap-2.5">
        <span
          data-testid="review-verdict-pill"
          className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11.5px] font-medium uppercase tracking-wide ${
            review.verdict === 'approved'
              ? 'border-[color:var(--success)]/40 bg-[color:var(--success)]/10 text-[color:var(--success)]'
              : review.verdict === 'needs-fix'
                ? 'border-orange-500/40 bg-orange-500/10 text-orange-400'
                : 'border-red-500/40 bg-red-500/10 text-red-400'
          }`}
        >
          <VerdictIcon size={11} className={verdictColor} />
          {verdictLabel}
        </span>
        <span className="text-[11.5px] text-fg-3">Confidence {confidencePct}%</span>
      </div>

      {/* Escalation reason */}
      {review.escalationReason && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12.5px] text-fg-2">
          <span className="font-medium text-red-400">Escalation: </span>
          {review.escalationReason}
        </div>
      )}

      {/* Pre-merge checklist */}
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

      {/* Findings */}
      {(review.findings?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-[0.14em] mb-3">
            Findings
          </h3>
          <div className="space-y-2">
            {review.findings.map((f) => (
              <div key={f.description} className="border border-line rounded-lg p-3 text-[12.5px]">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${SEVERITY_COLOR[f.severity] ?? 'bg-gray-500/15 text-gray-400'}`}
                  >
                    {f.severity}
                  </span>
                  {f.disposition != null && (
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${DISPOSITION_COLOR[f.disposition]}`}
                      data-testid="review-finding-disposition"
                    >
                      {formatDisposition(f.disposition, f.dispositionRef)}
                    </span>
                  )}
                  {f.file && (
                    <span className="font-mono text-[10px] text-fg-3 bg-bg-elev-2 px-1 py-0.5 rounded">
                      {f.file}
                      {f.line != null ? `:${f.line}` : ''}
                    </span>
                  )}
                </div>
                <div className="text-fg-2">{f.description}</div>
                {f.suggestion && <div className="text-[11px] text-fg-3 mt-1">→ {f.suggestion}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
