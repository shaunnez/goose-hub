// DOM queue panel: opens when a queue badge or queue zone is clicked.
// Lists items queued at a specific room. ≤ 100 lines.

import type Phaser from 'phaser';
import { useEffect } from 'react';
import type { RoomId } from '../lib/rooms';

interface QueuedItem {
  ticketId: string;
  externalId: string;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
}

interface QueuePanelProps {
  roomId: RoomId | null;
  items: QueuedItem[];
  onClose: () => void;
}

// Click event payload emitted by HudLayer on queue badge click
export interface QueueClickPayload {
  roomId: RoomId;
}

export function QueuePanel({ roomId, items, onClose }: QueuePanelProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (roomId == null) return null;

  const label = roomId.charAt(0).toUpperCase() + roomId.slice(1);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-label="Close queue panel"
        role="button"
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Enter' && onClose()}
      />
      <aside
        data-testid="queue-panel"
        className="absolute top-4 right-4 z-50 w-64 rounded-md border border-[#2B2D42] bg-[#2B2D42EE] text-[#D68FD6] shadow-xl"
        style={{ maxHeight: '50vh', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between border-b border-[#2B2D42] px-3 py-2">
          <span className="text-[11px] font-mono font-semibold">Queued at {label}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[#D68FD6] hover:text-white text-xs leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-[#D68FD6]">Nothing queued.</p>
        ) : (
          <ul className="divide-y divide-[#3A3D5C]">
            {items.map((item) => (
              <li key={item.ticketId} className="px-3 py-2 text-[10px] font-mono">
                <span className="text-[#D68FD6] mr-1">#{item.externalId}</span>
                <span className="truncate">{item.title || '(untitled)'}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}

/** Wires the sceneEmitter 'queue-click' event to the onQueueClick callback. */
export function useQueueClickSubscription(
  sceneEmitter: Phaser.Events.EventEmitter | null,
  onQueueClick: (payload: QueueClickPayload) => void,
): void {
  useEffect(() => {
    if (sceneEmitter == null) return;
    const handler = (p: QueueClickPayload) => onQueueClick(p);
    sceneEmitter.on('queue-click', handler);
    return () => {
      sceneEmitter.off('queue-click', handler);
    };
  }, [sceneEmitter, onQueueClick]);
}
