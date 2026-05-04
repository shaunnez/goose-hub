import type { InboxItemDto } from '@/lib/types';
import { Trash2 } from 'lucide-react';

interface InboxDetailProps {
  item: InboxItemDto;
  onPromote: (item: InboxItemDto) => void;
  onDelete: (item: InboxItemDto) => void;
}

export function InboxDetail({ item, onPromote, onDelete }: InboxDetailProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto px-8 py-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold text-fg leading-snug mb-2">{item.title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-fg-4 border border-line rounded px-1.5 py-0.5">
              {item.type}
            </span>
            <span className="text-[12px] text-fg-4">
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="promote-button"
            onClick={() => onPromote(item)}
            className="h-8 px-4 rounded-md border border-line text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover"
          >
            Promote
          </button>
          <button
            type="button"
            data-testid="delete-button"
            onClick={() => onDelete(item)}
            aria-label="Delete inbox item"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-line text-fg-3 hover:text-danger hover:border-danger/50 hover:bg-danger/5"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="border-t border-line pt-6">
        {item.body ? (
          <p className="text-[13px] text-fg-2 leading-relaxed whitespace-pre-wrap">{item.body}</p>
        ) : (
          <p className="text-[13px] text-fg-4 italic">No description.</p>
        )}
      </div>
    </div>
  );
}
