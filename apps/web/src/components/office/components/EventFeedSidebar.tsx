// Right-side event feed placeholder. Static rows for Phase 4; future phases
// will subscribe to the SSE event stream and render real entries.

interface FeedItem {
  ts: string;
  icon: string;
  iconClass: string;
  title: string;
  subtitle?: string;
}

const PLACEHOLDER_FEED: FeedItem[] = [
  {
    ts: '14:32',
    icon: '⚠',
    iconClass: 'text-red-400',
    title: 'QA failed',
    subtitle: 'GH-2471 · Retry 1/3',
  },
  {
    ts: '14:31',
    icon: '◯',
    iconClass: 'text-amber-400',
    title: 'Awaiting Review',
    subtitle: 'GH-2468',
  },
  {
    ts: '14:29',
    icon: '✓',
    iconClass: 'text-emerald-400',
    title: 'Tests passed',
    subtitle: 'GH-2467',
  },
  {
    ts: '14:28',
    icon: '⚙',
    iconClass: 'text-cyan-400',
    title: 'Code merged',
    subtitle: 'GH-2466 → main',
  },
  { ts: '14:27', icon: '↑', iconClass: 'text-fg-2', title: 'Commit pushed', subtitle: 'GH-2466' },
  {
    ts: '14:25',
    icon: '✓',
    iconClass: 'text-purple-400',
    title: 'Investigation done',
    subtitle: 'GH-2465',
  },
  {
    ts: '14:23',
    icon: '+',
    iconClass: 'text-fg-2',
    title: 'New ticket',
    subtitle: 'GH-2472 Refactor auth',
  },
  {
    ts: '14:21',
    icon: '✓',
    iconClass: 'text-emerald-400',
    title: 'Tests passed',
    subtitle: 'GH-2464',
  },
  {
    ts: '14:19',
    icon: '★',
    iconClass: 'text-purple-400',
    title: 'Retro complete',
    subtitle: 'GH-2463',
  },
];

export function EventFeedSidebar() {
  return (
    <div
      data-testid="office-event-feed"
      className="absolute top-0 right-0 bottom-0 w-44 bg-[#050309ee] border-l border-amber-500/30 z-30 font-mono text-[10px] text-fg-2 pointer-events-none flex flex-col"
    >
      <div className="px-3 py-3 border-b border-amber-500/20 flex-shrink-0">
        <span className="text-amber-400 font-bold tracking-wider text-[11px]">EVENT FEED</span>
      </div>
      <div className="px-2 py-2 space-y-2 overflow-hidden flex-1">
        {PLACEHOLDER_FEED.map((it) => (
          <div key={it.ts + it.title} className="flex gap-1.5 leading-tight">
            <span className="text-fg-3 w-9 flex-shrink-0">{it.ts}</span>
            <span className={`${it.iconClass} flex-shrink-0 w-3 text-center`}>{it.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="truncate">{it.title}</div>
              {it.subtitle != null && (
                <div className="text-fg-3 truncate text-[9px]">{it.subtitle}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-amber-500/20 text-[9px] text-fg-3 flex-shrink-0">
        Showing 9 of 132 events
      </div>
    </div>
  );
}
