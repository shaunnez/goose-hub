import { deleteInboxItem, fetchInboxItems } from '@/lib/api';
import type { InboxItemDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { InboxDetail } from './InboxDetail';
import { InboxEmpty } from './InboxEmpty';
import { PromoteModal } from './PromoteModal';

export function InboxList() {
  const [promoting, setPromoting] = useState<InboxItemDto | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInboxItems,
  });

  useEffect(() => {
    function handleCreated(e: Event) {
      const { id } = (e as CustomEvent<{ id: number }>).detail;
      setSelectedId(id);
    }
    window.addEventListener('inbox:item-created', handleCreated);
    return () => window.removeEventListener('inbox:item-created', handleCreated);
  }, []);

  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteInboxItem(id),
    onSuccess: () => {
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
  });

  function handleDelete(item: InboxItemDto) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    deleteMutation.mutate(item.id);
  }

  if (isLoading) return <div className="px-8 py-10 text-fg-3">Loading inbox…</div>;
  if (error)
    return <div className="px-8 py-10 text-[color:var(--danger)]">Failed to load inbox.</div>;
  if (items.length === 0) return <InboxEmpty />;

  const effectiveId = selectedId ?? items[0].id;
  const selectedItem = items.find((i) => i.id === effectiveId) ?? items[0];

  return (
    <div data-testid="inbox-list" className="flex h-full">
      {/* Left panel — list */}
      <div className="w-[35%] border-r border-line flex flex-col min-h-0">
        <div className="px-4 py-4 border-b border-line shrink-0">
          <h1 className="text-[14px] font-semibold text-fg">Inbox</h1>
        </div>
        <ol className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {items.map((item) => {
            const isSelected = item.id === effectiveId;
            return (
              <li key={item.id} data-testid="inbox-item" data-inbox-id={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={[
                    'w-full text-left rounded-md px-3 py-2.5 transition-colors',
                    isSelected
                      ? 'bg-accent/10 border border-accent/30'
                      : 'border border-transparent hover:bg-bg-hover',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'text-[12.5px] font-medium truncate',
                      isSelected ? 'text-fg' : 'text-fg-2',
                    ].join(' ')}
                  >
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10.5px] font-mono uppercase tracking-wider text-fg-2 border border-line rounded px-1 py-0.5">
                      {item.type}
                    </span>
                    <span className="text-[11px] text-fg-2">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 min-w-0 min-h-0 bg-bg-elev/30">
        <InboxDetail item={selectedItem} onPromote={setPromoting} onDelete={handleDelete} />
      </div>

      {promoting && <PromoteModal item={promoting} onClose={() => setPromoting(null)} />}
    </div>
  );
}
