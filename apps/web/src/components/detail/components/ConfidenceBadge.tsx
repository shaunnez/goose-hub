import { CONFIDENCE_COLOR } from '../lib/investigation';

export function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span
      data-testid="confidence-badge"
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${CONFIDENCE_COLOR[level] ?? 'bg-gray-500/15 text-gray-400'}`}
    >
      {level} confidence
    </span>
  );
}
