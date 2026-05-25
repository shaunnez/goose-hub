import { cn } from '@/lib/cn';
import { formatCost, formatTokens } from '@/lib/utils';
import { Coins } from 'lucide-react';

interface CostBadgeProps {
  tokens: number;
  usd: number;
  label?: 'estimated' | 'exact';
  size?: 'sm' | 'md';
  cacheHitRatio?: number;
  reasoningOutputTokens?: number;
  className?: string;
}

/**
 * Inline pill that renders `<coins> · <tokens> · <usd>`. Returns `null` when
 * both values are zero so unstarted runs / stages don't render `0 tok · $0`.
 * Estimated rows render `~$x.xx` per `formatCost` and surface the qualifier in
 * the tooltip.
 */
export function CostBadge({
  tokens,
  usd,
  label = 'exact',
  size = 'sm',
  cacheHitRatio,
  reasoningOutputTokens = 0,
  className,
}: CostBadgeProps) {
  if (tokens === 0 && usd === 0) return null;

  const sizeClass =
    size === 'md' ? 'h-6 px-2 gap-1.5 text-[11.5px]' : 'h-5 px-1.5 gap-1 text-[10.5px]';
  const iconSize = size === 'md' ? 11 : 10;
  const tokenStr = formatTokens(tokens);
  const costStr = formatCost(usd, label);
  const cachePct =
    cacheHitRatio != null && cacheHitRatio > 0 ? `${Math.round(cacheHitRatio * 100)}%` : null;
  const reasoningStr = reasoningOutputTokens > 0 ? formatTokens(reasoningOutputTokens) : null;
  const details = [
    `${tokenStr} tokens`,
    costStr,
    cachePct != null ? `${cachePct} cache hit` : null,
    reasoningStr != null ? `${reasoningStr} reasoning tokens` : null,
  ].filter((part): part is string => part != null);
  const title =
    label === 'estimated'
      ? `${details.join(' · ')} (estimated — CLI/OAuth synthetic rollup)`
      : details.join(' · ');

  return (
    <span
      data-testid="cost-badge"
      title={title}
      className={cn(
        'inline-flex items-center rounded-full border border-line/70 bg-bg/40 font-mono text-fg-3',
        sizeClass,
        className,
      )}
    >
      <Coins size={iconSize} className="opacity-70 shrink-0" />
      <span className="tnum">{tokenStr}</span>
      <span aria-hidden className="opacity-40">
        ·
      </span>
      <span className="tnum">{costStr}</span>
      {cachePct != null && (
        <>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="tnum">cache {cachePct}</span>
        </>
      )}
      {reasoningStr != null && (
        <>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="tnum">r {reasoningStr}</span>
        </>
      )}
    </span>
  );
}
