import { Info } from 'lucide-react';

/**
 * One-line legend explaining the `~$` prefix. Renders only when at least one
 * row in scope is `'estimated'`. Spec: M9.09.
 */
export function CostLegend() {
  return (
    <div
      data-testid="cost-legend"
      className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-3"
    >
      <Info size={12} />
      <span>
        <span className="font-mono">~$</span> = estimated (Claude CLI). Unprefixed = exact (API
        usage metadata).
      </span>
    </div>
  );
}
