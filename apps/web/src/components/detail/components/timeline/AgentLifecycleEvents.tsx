import type { AgentEventDto } from '@/lib/types';
import { Bot, CheckCircle, Circle, XCircle } from 'lucide-react';
import { EVENT_KIND_LABEL } from '../../lib/timeline';

export function AgentSpawnedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { skill?: string } | null;
  const skill = p?.skill ?? '';
  return (
    <li
      key={event.id}
      data-event-kind={event.kind}
      className="rounded-md border border-line border-l-2 border-l-[color:var(--accent)] bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Bot size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Agent started: {skill}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function AgentTerminatedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { status?: string; skill?: string } | null;
  const completed = p?.status === 'completed';
  const label = completed ? 'Agent finished' : 'Agent failed';
  const skill = p?.skill ?? '';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        {completed ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {label}
          {skill ? `: ${skill}` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function AgentRunStatusEvent({ event }: { event: AgentEventDto }) {
  const isCompleted = event.kind === 'agent.run-completed';
  const isFailed = event.kind === 'agent.run-failed';
  const p = event.payload as { runId?: string; error?: string; skill?: string } | null;
  const skillSuffix = p?.skill != null ? `: ${p.skill}` : '';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px]  ">
        {isCompleted ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : isFailed ? (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        ) : (
          <Circle size={13} className="shrink-0 text-[color:var(--accent)]" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {EVENT_KIND_LABEL[event.kind] ?? event.kind}
          {skillSuffix}
          {isFailed && p?.error != null ? ` — ${p.error}` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}
