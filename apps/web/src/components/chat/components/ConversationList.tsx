import { cn } from '@/lib/cn';
import type { ChatConversationDto } from '@/lib/types';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface ConversationListProps {
  conversations: ChatConversationDto[];
  activeConversationId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

/**
 * Renders the conversation history inline with the panel body. The agent
 * thread only renders when an active conversation is selected; this is the
 * "between conversations" view shown otherwise.
 */
export function ConversationList({
  conversations,
  activeConversationId,
  busy,
  onSelect,
  onDelete,
  onNew,
}: ConversationListProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Group by scope so the user can scan project conversations together.
  const grouped = groupByScope(conversations);

  return (
    <div data-testid="chat-conversation-list" className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line bg-bg-elev">
        <span className="text-[11px] uppercase tracking-wider text-fg-2">
          Conversations · {conversations.length}
        </span>
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          data-testid="chat-new-conversation"
          className={cn(
            'ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[11.5px]',
            'bg-accent text-bg hover:bg-accent/90 disabled:opacity-50',
          )}
        >
          <Plus size={12} /> New
        </button>
      </div>
      {conversations.length === 0 && (
        <div className="text-center text-fg-2 text-[12px] py-8">
          <p className="mb-1">No conversations yet.</p>
          <p>Click "New" to start one.</p>
        </div>
      )}
      {grouped.map((group) => (
        <div key={group.label} className="py-2">
          <div className="px-3 text-[10.5px] uppercase tracking-wider text-fg-3">{group.label}</div>
          <ul>
            {group.items.map((c) => (
              <li
                key={c.id}
                data-testid="chat-conversation-row"
                data-conversation-id={c.id}
                className={cn(
                  'mx-2 my-1 rounded-md border border-line bg-bg flex items-stretch',
                  'hover:bg-bg-hover transition-colors',
                  activeConversationId === c.id && 'border-accent',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="flex-1 min-w-0 text-left px-2.5 py-1.5"
                  data-testid="chat-conversation-select"
                  disabled={busy}
                >
                  <div className="truncate text-[12.5px] text-fg">
                    {c.title || '(empty conversation)'}
                  </div>
                  <div className="text-[10.5px] text-fg-2 mt-0.5">
                    {formatScopeRef(c)} · {formatRelative(c.updatedAt)}
                  </div>
                </button>
                {pendingDelete === c.id ? (
                  <div className="flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(c.id);
                        setPendingDelete(null);
                      }}
                      data-testid="chat-conversation-delete-confirm"
                      className="text-red-300 text-[11px] hover:text-red-200 px-1.5 py-0.5 rounded bg-red-900/30"
                    >
                      Delete?
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(null)}
                      className="text-fg-2 text-[11px] hover:text-fg px-1.5 py-0.5 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={() => setPendingDelete(c.id)}
                    data-testid="chat-conversation-delete"
                    className="px-2 text-fg-2 hover:text-red-300"
                    disabled={busy}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface ScopeGroup {
  label: string;
  items: ChatConversationDto[];
}

function groupByScope(conversations: ChatConversationDto[]): ScopeGroup[] {
  const groups = new Map<string, ChatConversationDto[]>();
  for (const c of conversations) {
    const key = c.scope;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  // Stable order: item → project → global so per-issue threads sit on top.
  const order: Array<{ key: string; label: string }> = [
    { key: 'item', label: 'Work item' },
    { key: 'project', label: 'Project' },
    { key: 'global', label: 'Global' },
  ];
  return order
    .filter((o) => groups.has(o.key))
    .map((o) => ({ label: o.label, items: groups.get(o.key) ?? [] }));
}

function formatScopeRef(c: ChatConversationDto): string {
  if (c.scope === 'item' && c.projectId && c.workItemId) {
    return `${c.projectId} ${c.workItemId.split('#').pop() ?? c.workItemId}`;
  }
  if (c.scope === 'project' && c.projectId) return c.projectId;
  return 'global';
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const delta = Math.max(0, now - then);
    const minutes = Math.floor(delta / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
