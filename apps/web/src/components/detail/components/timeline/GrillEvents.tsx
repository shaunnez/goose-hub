import type { AgentEventDto } from '@/lib/types';
import { CheckCircle2, MessageCircleQuestion } from 'lucide-react';

export function GrillQuestionPostedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { roundNumber?: number; question?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-accent/30 bg-accent-soft/10 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <MessageCircleQuestion size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Grill question</span>
        {p?.roundNumber != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">Round {p.roundNumber}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.question != null && <p className="text-[12px] text-fg-2 leading-relaxed">{p.question}</p>}
    </li>
  );
}

export function GrillCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    refinedIntent?: string;
    rounds?: number;
    forced?: boolean;
  } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <CheckCircle2 size={13} className="shrink-0 text-[color:var(--success)]" />
        <span className="font-mono uppercase tracking-wider">Grill complete</span>
        {p?.rounds != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">
              {p.rounds} round{p.rounds === 1 ? '' : 's'}
            </span>
          </>
        )}
        {p?.forced && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">force-completed</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.refinedIntent != null && (
        <p className="text-[12px] text-fg-2 leading-relaxed italic">{p.refinedIntent}</p>
      )}
    </li>
  );
}
