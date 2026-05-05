import { cn } from '@/lib/cn';
import { formatCost, formatTokens } from '@/lib/utils';
import { Coins } from 'lucide-react';

interface CostBadgeProps {
  tokens: number;
  usd: number;
  label?: 'estimated' | 'exact';
  size?: 'sm' | 'md';
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
  className,
}: CostBadgeProps) {
  if (tokens === 0 && usd === 0) return null;

  const sizeClass =
    size === 'md' ? 'h-6 px-2 gap-1.5 text-[11.5px]' : 'h-5 px-1.5 gap-1 text-[10.5px]';
  const iconSize = size === 'md' ? 11 : 10;
  const tokenStr = formatTokens(tokens);
  const costStr = formatCost(usd, label);
  const title =
    label === 'estimated'
      ? `${tokenStr} tokens · ${costStr} (estimated — Claude CLI rollup)`
      : `${tokenStr} tokens · ${costStr}`;

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
    </span>
  );
}
