import type { AgentEventDto } from '@/lib/types';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  MessageSquareDiff,
  SkipForward,
  XCircle,
} from 'lucide-react';

type Ac = { id?: string; statement?: string };
type Slice = { title?: string; estimatedSize?: string };

export function PrdDraftedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    prd?: {
      title?: string;
      problem?: string;
      estimatedComplexity?: string;
      acceptanceCriteria?: Ac[];
      verticalSlices?: Slice[];
    };
    advisorConcerns?: string | null;
  } | null;

  const prd = p?.prd;
  const title = prd?.title;
  const problem = prd?.problem;
  const problemPreview =
    problem != null ? (problem.length > 140 ? `${problem.slice(0, 139)}…` : problem) : null;
  const complexity = prd?.estimatedComplexity;
  const acCount = prd?.acceptanceCriteria?.length ?? 0;
  const sliceCount = prd?.verticalSlices?.length ?? 0;
  const concerns = p?.advisorConcerns;

  const complexityColor =
    complexity === 'low'
      ? 'text-green-400'
      : complexity === 'medium'
        ? 'text-yellow-400'
        : complexity === 'high'
          ? 'text-[color:var(--danger)]'
          : 'text-fg-3';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <FileText size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">PRD drafted</span>
        {complexity != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className={`font-mono font-medium ${complexityColor}`}>{complexity}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {title != null && (
        <p className="text-[12.5px] text-fg-1 font-medium mb-1 leading-snug">{title}</p>
      )}
      {problemPreview != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{problemPreview}</p>
      )}
      <div className="flex gap-3 text-[11px] text-fg-3 font-mono">
        {acCount > 0 && (
          <span>
            <span className="text-fg-2">{acCount}</span> AC{acCount !== 1 ? 's' : ''}
          </span>
        )}
        {sliceCount > 0 && (
          <span>
            <span className="text-fg-2">{sliceCount}</span> slice{sliceCount !== 1 ? 's' : ''}
          </span>
        )}
        {concerns != null && <span className="text-yellow-400">advisor concerns</span>}
      </div>
    </li>
  );
}

export function PrdAdvisorSkippedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { reason?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <SkipForward size={13} className="shrink-0 text-fg-4" />
        <span className="font-mono uppercase tracking-wider">Advisor skipped</span>
        {p?.reason != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">{p.reason}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function PrdApprovedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <CheckCircle2 size={13} className="shrink-0 text-[color:var(--success)]" />
        <span className="font-mono uppercase tracking-wider">PRD approved</span>
        {p?.source != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">via {p.source}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function PrdRejectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; reason?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        <span className="font-mono uppercase tracking-wider">PRD rejected</span>
        {p?.source != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">via {p.source}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.reason != null && <p className="text-[11.5px] text-fg-2 leading-relaxed">{p.reason}</p>}
    </li>
  );
}

export function PrdRevisedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; concerns?: string[] } | null;
  const concerns = p?.concerns ?? [];
  return (
    <li
      data-event-kind={event.kind}
      data-testid="prd-revised-event"
      className="rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <MessageSquareDiff size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">PRD revision requested</span>
        {p?.source != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">via {p.source}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {concerns.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11.5px] text-fg-2 space-y-0.5">
          {concerns.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: concern list has no stable id
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function PrdDeclinedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      data-testid="prd-declined-event"
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        <span className="font-mono uppercase tracking-wider">Feature declined</span>
        {p?.source != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-3">via {p.source}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}
