import type { AgentEventDto } from '@/lib/types';
import { Tag } from 'lucide-react';

export function AgentTriageCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    triage?: {
      type?: string;
      priority?: string;
      labels?: string[];
      reasoning?: string;
    };
    repoMatch?: {
      candidates?: { repo?: string; confidence?: number; tier?: number }[];
    };
  } | null;
  const t = p?.triage;
  const topRepo = p?.repoMatch?.candidates?.[0];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-success bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <Tag size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Triage complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {t != null && (
        <div className="flex flex-wrap gap-2 mb-2">
          {t.type != null && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-2">
              {t.type}
            </span>
          )}
          {t.priority != null && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-2">
              {t.priority}
            </span>
          )}
          {t.labels?.map((l) => (
            <span
              key={l}
              className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-3"
            >
              {l}
            </span>
          ))}
        </div>
      )}
      {t?.reasoning != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{t.reasoning}</p>
      )}
      {topRepo != null && (
        <div className="text-[11px] text-fg-3 font-mono">
          repo: <span className="text-fg-2">{topRepo.repo}</span>
          {topRepo.confidence != null && (
            <span className="text-fg-2 ml-2">{topRepo.confidence}% confidence</span>
          )}
        </div>
      )}
    </li>
  );
}
