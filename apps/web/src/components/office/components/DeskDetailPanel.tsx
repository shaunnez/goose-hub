// Slide-in panel that shows the issue currently at a clicked desk. Opens on
// `desk-click` from the Phaser scene; closes via Esc, the X button, or
// clicking the backdrop.
//
// Deliberately minimal — it links out to the full DetailPage rather than
// duplicating the rich rails/sections rendered there.

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { DeskClickPayload } from '../game/OfficeScene';

interface DeskDetailPanelProps {
  payload: DeskClickPayload | null;
  onClose: () => void;
}

export function DeskDetailPanel({ payload, onClose }: DeskDetailPanelProps) {
  // Close on Esc.
  useEffect(() => {
    if (payload == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [payload, onClose]);

  if (payload == null) return null;

  return (
    <>
      {/* Backdrop — click to dismiss. */}
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/30"
      />
      <aside
        aria-label={`Issue ${payload.externalId}`}
        data-testid="office-desk-detail"
        className="fixed top-0 right-0 z-40 h-full w-[320px] flex flex-col border-l border-line bg-bg-elev shadow-2xl"
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <span className="font-mono text-[12px] text-fg-3 tabular-nums">
            #{payload.externalId}
          </span>
          <h2 className="text-[13px] font-medium text-fg flex-1 truncate" title={payload.title}>
            {payload.title || 'Active issue'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-2 hover:text-fg p-1 rounded"
          >
            <X size={14} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-[12px] text-fg-2 leading-relaxed">
            An agent at this desk is currently working on this issue. Open the full detail view for
            status, timeline, and gates.
          </p>
          <Link
            to={`/projects/${encodeURIComponent(payload.projectSlug)}/items/${encodeURIComponent(payload.externalId)}`}
            className="inline-block px-3 py-1.5 rounded-md border border-line bg-bg-hover hover:bg-bg-2 text-[12px] text-fg"
            data-testid="office-open-detail"
          >
            Open full detail →
          </Link>
        </div>
      </aside>
    </>
  );
}
