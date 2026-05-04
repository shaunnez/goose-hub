import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/cn';
import { PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import type { WorkItemDto } from '@/lib/types';
import { getPersonaInitials, usePersonaMap } from '@/lib/usePersonaMap';
import { ageLabel } from '@/lib/utils';
import { Link } from 'react-router-dom';

// Placeholder until M9 wires real cost data.
const COST_PLACEHOLDER = '$—';

export function IssueCard({
  item,
  projectSlug,
}: {
  item: WorkItemDto;
  projectSlug: string;
}) {
  const ageStr = ageLabel(item.createdAt);
  const personaMap = usePersonaMap();
  const initials = getPersonaInitials(personaMap, item.lastPersonaId);
  return (
    <Link
      to={`/projects/${projectSlug}/items/${item.externalId}`}
      data-testid="issue-card"
      data-issue-number={item.externalId}
      data-state={item.state}
      className={cn(
        'block rounded-md border border-line bg-bg-elev px-3 py-2.5',
        'hover:border-line-2 hover:bg-bg-hover transition-colors',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: PRIORITY_COLOR[item.priority] ?? 'var(--fg-3)' }}
        />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
          #{item.externalId}
        </span>
        <span className="grow" />
        <span className="font-mono tnum text-[10.5px] text-fg-4">{ageStr}</span>
      </div>
      <div className="text-[12.5px] text-fg leading-snug font-medium mb-2">
        {item.title.length <= 55 ? item.title : `${item.title.slice(0, 54).trimEnd()}…`}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill tone="default" className="h-5 text-[10.5px] px-2">
          {STATE_LABEL[item.state] ?? item.state}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.type}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.priority}
        </Pill>
        {initials != null && (
          <span
            title={item.lastPersonaId ?? undefined}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[color:var(--accent)]/15 text-[color:var(--accent)] font-mono text-[9px] font-bold shrink-0"
            data-testid="persona-initials"
          >
            {initials}
          </span>
        )}
        <span
          className="ml-auto font-mono text-[10.5px] text-fg-4"
          title="Cost tracking available in M9"
          data-testid="cost-placeholder"
        >
          {COST_PLACEHOLDER}
        </span>
      </div>
    </Link>
  );
}
