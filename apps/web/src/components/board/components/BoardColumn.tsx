import type { LaneConfig } from '@/lib/lanes.config';
import type { WorkItemDto } from '@/lib/types';
import { Eye, EyeOff } from 'lucide-react';
import { IssueCard } from './IssueCard';

interface BoardColumnProps {
  lane: LaneConfig;
  items: WorkItemDto[];
  projectSlug: string;
  onHide: (key: string) => void;
}

export function BoardColumn({ lane, items, projectSlug, onHide }: BoardColumnProps) {
  return (
    <div
      data-testid={`lane-${lane.key}`}
      className="flex-1 min-w-[260px] max-w-[320px] flex flex-col rounded-lg border border-line bg-bg/60"
    >
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-line shrink-0">
        <span className="text-[12.5px] font-semibold tracking-tight">{lane.label}</span>
        <span className="font-mono tnum text-[11px] text-fg-3">{items.length}</span>
        <span className="grow" />
        <button
          type="button"
          aria-label={`Hide ${lane.label}`}
          title={`Hide ${lane.label}`}
          onClick={() => onHide(lane.key)}
          className="text-fg-3 hover:text-fg p-1 rounded hover:bg-bg-hover transition-colors"
        >
          {lane.hiddenByDefault ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="text-[11.5px] text-fg-2 px-2 py-4 text-center italic">empty</div>
        ) : (
          items.map((item) => <IssueCard key={item.id} item={item} projectSlug={projectSlug} />)
        )}
      </div>
    </div>
  );
}
