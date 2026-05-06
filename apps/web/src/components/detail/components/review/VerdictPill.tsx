import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { type ReviewVerdict, VERDICT_LABEL } from '../../lib/review';

export function VerdictPill({
  verdict,
  confidence,
}: {
  verdict: ReviewVerdict;
  confidence: number;
}) {
  const VerdictIcon =
    verdict === 'approved' ? CheckCircle : verdict === 'needs-fix' ? XCircle : AlertTriangle;
  const verdictColor =
    verdict === 'approved'
      ? 'text-[color:var(--success)]'
      : verdict === 'needs-fix'
        ? 'text-orange-500'
        : 'text-red-500';
  const confidencePct = Math.round(confidence * 100);
  const verdictLabel = VERDICT_LABEL[verdict] ?? String(verdict ?? 'unknown');

  return (
    <div className="flex items-center gap-2.5">
      <span
        data-testid="review-verdict-pill"
        className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11.5px] font-medium uppercase tracking-wide ${
          verdict === 'approved'
            ? 'border-[color:var(--success)]/40 bg-[color:var(--success)]/10 text-[color:var(--success)]'
            : verdict === 'needs-fix'
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-400'
              : 'border-red-500/40 bg-red-500/10 text-red-400'
        }`}
      >
        <VerdictIcon size={11} className={verdictColor} />
        {verdictLabel}
      </span>
      <span className="text-[11.5px] text-fg-3">Confidence {confidencePct}%</span>
    </div>
  );
}
