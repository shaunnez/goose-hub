import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';

interface ReviewSectionProps {
  projectSlug: string;
  id: string;
}

interface CriterionCheck {
  criterion: string;
  status: 'met' | 'unmet' | 'unclear';
  notes?: string;
}

interface ReviewFinding {
  criterion?: string;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  suggestion?: string;
  file?: string;
  line?: number;
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

export function ReviewSection({ projectSlug, id }: ReviewSectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  if (isLoading) return null;

  const reviewEvent = [...events].reverse().find((e) => e.kind === 'review.completed');
  const review = reviewEvent?.payload as ReviewPayload | undefined;

  if (!review) {
    return (
      <div
        data-testid="review-empty-state"
        className="px-8 py-8 flex flex-col items-center justify-center gap-2 text-center"
      >
        <Clock size={24} className="text-fg-3 opacity-50" />
        <p className="text-[13px] text-fg-3">Waiting for Review to run…</p>
        <p className="text-[12px] text-fg-4">Review runs automatically after QA passes.</p>
      </div>
    );
  }

  const VerdictIcon =
    review.verdict === 'approved'
      ? CheckCircle
      : review.verdict === 'needs-fix'
        ? XCircle
        : AlertTriangle;
  const verdictColor =
    review.verdict === 'approved'
      ? 'text-green-500'
      : review.verdict === 'needs-fix'
        ? 'text-orange-500'
        : 'text-red-500';
  const verdictBg =
    review.verdict === 'approved'
      ? 'bg-green-500/10 border-green-500/20'
      : review.verdict === 'needs-fix'
        ? 'bg-orange-500/10 border-orange-500/20'
        : 'bg-red-500/10 border-red-500/20';

  return (
    <div data-testid="review-section" className="px-8 py-6 space-y-6">
      {/* Verdict header */}
      <div className={`flex items-center gap-3 p-4 rounded-lg border ${verdictBg}`}>
        <VerdictIcon size={20} className={verdictColor} />
        <div>
          <div className="font-semibold text-[13px] uppercase tracking-wide">
            {review.verdict.replace(/-/g, ' ')}
          </div>
          <div className="text-[12px] text-fg-3">
            Confidence: {Math.round(review.confidence * 100)}%
          </div>
        </div>
      </div>

      {/* Escalation reason (needs-human only) */}
      {review.escalationReason && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12.5px] text-fg-2">
          <span className="font-medium text-red-400">Escalation: </span>
          {review.escalationReason}
        </div>
      )}

      {/* Acceptance criteria checks */}
      {review.criteriaChecks.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Acceptance Criteria
          </h3>
          <div className="space-y-2">
            {review.criteriaChecks.map((check) => (
              <div key={check.criterion} className="flex items-start gap-2.5 text-[12.5px]">
                {check.status === 'met' ? (
                  <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
                ) : check.status === 'unmet' ? (
                  <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className={check.status === 'unmet' ? 'text-fg' : 'text-fg-2'}>
                    {check.criterion}
                  </span>
                  {check.notes && <p className="text-[11px] text-fg-3 mt-0.5">{check.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Findings */}
      {review.findings.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Findings
          </h3>
          <div className="space-y-2">
            {review.findings.map((f) => (
              <div key={f.description} className="border border-line rounded-lg p-3 text-[12.5px]">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${SEVERITY_COLOR[f.severity] ?? 'bg-gray-500/15 text-gray-400'}`}
                  >
                    {f.severity}
                  </span>
                  {f.file && (
                    <span className="font-mono text-[10px] text-fg-3 bg-bg-glass px-1 py-0.5 rounded">
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
