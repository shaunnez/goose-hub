import { STATE_LABEL } from '@/lib/constants';

interface FeedItem {
  externalId: string;
  projectName: string;
  title: string;
  state: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: string;
}

interface EventFeedSidebarProps {
  items: FeedItem[];
}

const PRIORITY_DOT: Record<FeedItem['priority'], string> = {
  critical: 'bg-red-400',
  high: 'bg-amber-400',
  normal: 'bg-emerald-400',
  low: 'bg-fg-3',
};

export function EventFeedSidebar({ items }: EventFeedSidebarProps) {
  return (
    <div
      data-testid="office-event-feed"
      className="absolute top-0 right-0 bottom-0 w-44 bg-[#050309ee] border-l border-amber-500/30 z-30 font-mono text-[10px] text-fg-2 pointer-events-none flex flex-col"
    >
      <div className="px-3 py-3 border-b border-amber-500/20 flex-shrink-0">
        <span className="text-amber-400 font-bold tracking-wider text-[11px]">LIVE WORK</span>
      </div>
      <div className="px-2 py-2 space-y-2 overflow-hidden flex-1">
        {items.length === 0 ? (
          <div className="px-1 py-2 text-fg-3 leading-tight">No active work items.</div>
        ) : (
          items.map((it) => (
            <div key={`${it.projectName}:${it.externalId}`} className="flex gap-1.5 leading-tight">
              <span className="text-fg-3 w-9 flex-shrink-0">{shortTime(it.createdAt)}</span>
              <span
                className={`mt-1 inline-block size-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[it.priority]}`}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-fg">{`#${it.externalId} ${it.title}`}</div>
                <div className="text-fg-3 truncate text-[9px]">
                  {labelForState(it.state)} · {it.projectName}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-amber-500/20 text-[9px] text-fg-3 flex-shrink-0">
        Showing {Math.min(items.length, 12)} live item{items.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function labelForState(state: string): string {
  return STATE_LABEL[state] ?? state.replace(/^factory:/, '');
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
