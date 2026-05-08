import type { TimelineContext } from '@/components/detail/lib/timeline';
import type { AgentEventDto } from '@/lib/types';
import { GitFork } from 'lucide-react';
import { Link } from 'react-router-dom';

export function DecomposeCompletedEvent({
  event,
  context,
}: {
  event: AgentEventDto;
  context?: TimelineContext;
}) {
  const p = event.payload as { childIssueNumbers?: number[] } | null;
  const children = p?.childIssueNumbers ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <GitFork size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Decompose complete</span>
        {children.length > 0 && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">
              {children.length} issue{children.length === 1 ? '' : 's'} created
            </span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {children.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {children.map((n) =>
            context?.slug != null ? (
              <Link
                key={n}
                to={`/projects/${context.slug}/items/${n}`}
                className="font-mono text-[11px] text-accent bg-bg-elev px-1.5 py-0.5 rounded border border-line hover:border-accent/50 transition-colors"
              >
                Issue #{n}
              </Link>
            ) : (
              <span
                key={n}
                className="font-mono text-[11px] text-fg-2 bg-bg-elev px-1.5 py-0.5 rounded border border-line"
              >
                Issue #{n}
              </span>
            ),
          )}
        </div>
      )}
    </li>
  );
}
