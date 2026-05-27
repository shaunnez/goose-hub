import { cn } from '@/lib/cn';
import { ChevronRight } from 'lucide-react';
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';
import type {
  OverviewWorkflowCard,
  OverviewWorkflowStatusTone,
} from '../lib/overview-workflow-summary';
import { CostBadge } from './CostBadge';

export interface WorkflowSummaryCardProps {
  card: OverviewWorkflowCard;
}

const TONE_CLASSES: Record<OverviewWorkflowStatusTone, string> = {
  neutral: 'border-line bg-bg text-fg-2',
  active: 'border-accent/30 bg-accent/10 text-accent',
  success:
    'border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  danger: 'border-red-500/30 bg-red-500/10 text-red-700',
  muted: 'border-line bg-bg-elev-2 text-fg-3',
};

const SECTION_ROUTE_KEY: Record<string, string> = {
  triage: 'repo',
  retro: 'retrospective',
};

export function WorkflowSummaryCard({ card }: WorkflowSummaryCardProps): JSX.Element {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const routeSection =
    card.hrefSection == null ? null : (SECTION_ROUTE_KEY[card.hrefSection] ?? card.hrefSection);
  const href = routeSection == null ? null : `/projects/${slug}/items/${id}/${routeSection}`;

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2">{card.title}</div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                TONE_CLASSES[card.statusTone],
              )}
            >
              {card.status}
            </span>
          </div>
        </div>
        {href ? <ChevronRight size={14} className="mt-0.5 shrink-0 text-fg-4" /> : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {card.metrics.map((metric) => (
          <div key={`${card.key}-${metric.label}`} className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wider text-fg-3">{metric.label}</dt>
            <dd className="mt-1 truncate text-[12.5px] font-medium text-fg">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {card.footer ? (
        <div className="mt-4 border-t border-line pt-3">
          <CostBadge
            tokens={card.footer.tokens}
            usd={card.footer.usd}
            label={card.footer.label}
            size="sm"
          />
        </div>
      ) : null}
    </>
  );

  const className =
    'rounded-lg border border-line bg-bg-elev px-4 py-3 transition-colors hover:border-line/80';

  if (href) {
    return (
      <a
        href={href}
        aria-label={`Open ${card.title} section`}
        className={cn(className, 'block focus:outline-none focus:ring-2 focus:ring-accent/30')}
      >
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}
