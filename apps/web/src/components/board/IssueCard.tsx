import { Pill } from '@/components/ui/pill';
import type { WorkItemDto } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Link } from 'react-router-dom';

// Priority colour-coding per #32:
// critical = red, high = orange, medium = yellow, low = grey.
const PRIORITY_COLOR: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22)', // red
  high: 'oklch(0.74 0.15 50)', // orange
  medium: 'oklch(0.78 0.14 78)', // yellow
  low: 'var(--fg-3)', // grey
};

function ageLabel(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const minutes = Math.max(0, Math.floor((now - created) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const STATE_LABEL: Record<string, string> = {
  'factory:triaging': 'triaging',
  'factory:accepted': 'accepted',
  'factory:rejected': 'rejected',
  'factory:grilling': 'grilling',
  'factory:prd-drafting': 'prd-drafting',
  'factory:prd-review': 'prd-review',
  'factory:decomposing': 'decomposing',
  'factory:issues-created': 'issues-created',
  'factory:research-pending': 'research-pending',
  'factory:research-complete': 'research-complete',
  'factory:investigating': 'investigating',
  'factory:investigation-complete': 'investigation-complete',
  'factory:dev-ready': 'dev-ready',
  'factory:in-progress': 'in-progress',
  'factory:needs-qa': 'needs-qa',
  'factory:qa-failed': 'qa-failed',
  'factory:needs-review': 'needs-review',
  'factory:needs-fix': 'needs-fix',
  'factory:approved': 'approved',
  'factory:retrospecting': 'retrospecting',
  'factory:needs-human': 'needs-human',
  'factory:done': 'done',
  'factory:archived': 'archived',
};

export function IssueCard({
  item,
  projectSlug,
}: {
  item: WorkItemDto;
  projectSlug: string;
}) {
  const ageStr = ageLabel(item.createdAt);
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
        {truncate(item.title, 55)}
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
      </div>
    </Link>
  );
}
