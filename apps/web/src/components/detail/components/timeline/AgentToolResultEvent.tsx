import type { AgentEventDto } from '@/lib/types';
import { ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { useState } from 'react';

export function AgentToolResultEvent({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as {
    tool_name?: string;
    error?: string;
    truncated?: boolean;
  } | null;
  const toolName = p?.tool_name ?? 'Bash';
  const errorText = p?.error ?? '';
  const truncated = p?.truncated === true;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 px-4 py-2"
    >
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1.5 cursor-pointer list-none font-mono text-[11.5px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <XCircle size={11} className="shrink-0 text-[color:var(--danger)]" />
          <span className="text-[color:var(--danger)]">{toolName} error</span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4 ml-1" />
          <span className="font-mono tnum text-fg-3">
            {new Date(event.createdAt).toLocaleString()}
          </span>
        </summary>
        {errorText.length > 0 && (
          <div className="mt-1.5">
            <pre className="font-mono text-[10px] text-[color:var(--danger)]/80 whitespace-pre-wrap break-all line-clamp-10 overflow-x-auto">
              {errorText}
            </pre>
            {truncated && (
              <span className="text-[9.5px] text-fg-3 italic">… truncated at 2 KB</span>
            )}
          </div>
        )}
      </details>
    </li>
  );
}
