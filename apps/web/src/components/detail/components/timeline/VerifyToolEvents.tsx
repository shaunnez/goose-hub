import type { AgentEventDto } from '@/lib/types';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

export function AgentVerifyCommandEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    ac?: string;
    command?: string;
    actual?: string;
    passed?: boolean;
  } | null;
  const passed = p?.passed ?? false;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px]">
        {passed ? (
          <CheckCircle size={12} style={{ color: 'var(--success)' }} />
        ) : (
          <XCircle size={12} style={{ color: 'var(--danger)' }} />
        )}
        <span className="font-mono uppercase tracking-wider">Verify AC: {p?.ac ?? '—'}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.command != null && (
        <div className="mt-1 mono text-[10.5px] text-fg-3 truncate">{p.command}</div>
      )}
    </li>
  );
}

export function ToolWarningEvent({ event }: { event: AgentEventDto }) {
  const label =
    event.kind === 'tool.stdout-truncated' ? 'Stdout truncated at 4 MB' : 'Process timed out';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-yellow-400" />
        <span className="font-mono uppercase tracking-wider">{label}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}
