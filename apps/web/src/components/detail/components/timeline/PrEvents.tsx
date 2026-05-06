import type { AgentEventDto } from '@/lib/types';
import { ExternalLink, GitPullRequest } from 'lucide-react';

export function PrMergedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { prNumber?: number; sha?: string } | null;
  const shortSha = p?.sha != null ? p.sha.slice(0, 7) : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <GitPullRequest size={13} className="shrink-0 text-purple-400" />
        <span className="font-mono uppercase tracking-wider">PR merged</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        {shortSha != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono text-fg-3">{shortSha}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function PrOpenedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { prNumber?: number; prUrl?: string; branch?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <GitPullRequest size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">PR opened</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.prUrl != null && (
        <a
          href={p.prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11.5px] text-[color:var(--accent)] hover:underline"
        >
          <ExternalLink size={11} />
          {p.prUrl}
        </a>
      )}
    </li>
  );
}
