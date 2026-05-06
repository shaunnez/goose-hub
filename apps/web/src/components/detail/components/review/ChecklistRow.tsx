import { AlertTriangle, Check, XCircle } from 'lucide-react';
import type { CriterionCheck } from '../../lib/review';

export function ChecklistRow({ check, isFirst }: { check: CriterionCheck; isFirst: boolean }) {
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
