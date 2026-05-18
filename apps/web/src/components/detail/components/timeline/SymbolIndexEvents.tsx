import type { AgentEventDto } from '@/lib/types';
import { Lightbulb } from 'lucide-react';

type SymbolIndexHintSource =
  | 'definition'
  | 'importer'
  | 'nearby-test'
  | 'key-file'
  | 'symbol-impact';

type SymbolIndexHintsUsedPayload = {
  consumerSkill?: string;
  offeredHintCount?: number;
  usedHintCount?: number;
  usedHints?: Array<{
    name?: string;
    path?: string;
    source?: SymbolIndexHintSource;
  }>;
};

export function SymbolIndexHintsUsedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as SymbolIndexHintsUsedPayload | null;
  const consumerSkill = p?.consumerSkill ?? 'agent';
  const usedHintCount = p?.usedHintCount ?? p?.usedHints?.length ?? 0;
  const offeredHintCount = p?.offeredHintCount ?? usedHintCount;
  const usedHints = p?.usedHints ?? [];

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Lightbulb size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Symbol hints used</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {consumerSkill} used {usedHintCount} of {offeredHintCount} offered hints
      </div>
      {usedHints.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {usedHints.map((hint, idx) => (
            <div
              key={`${hint.name ?? 'hint'}-${hint.path ?? idx}-${idx}`}
              className="flex min-w-0 items-baseline gap-2 text-[11.5px]"
            >
              <span className="shrink-0 font-medium text-fg-2">{hint.name ?? 'Symbol'}</span>
              <span className="min-w-0 truncate font-mono text-fg-3">{hint.path ?? 'unknown'}</span>
              <span className="shrink-0 text-fg-4">· {hint.source ?? 'definition'}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
