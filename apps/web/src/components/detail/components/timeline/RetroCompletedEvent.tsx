import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import { RefreshCw } from 'lucide-react';

export function RetroCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    tier?: 'light' | 'deep';
    output?: {
      outcome?: string;
      summary?: {
        wentWell?: string;
        didNotGoWell?: string;
        architecturalTakeaway?: string;
      };
      improvementCandidates?: unknown[];
    };
  } | null;

  const tier = p?.tier ?? 'light';
  const outcome = p?.output?.outcome ?? 'unknown';
  const isSuccess = outcome === 'success';
  const summary = p?.output?.summary;
  const summaryRows: { label: string; text: string }[] = [];
  if (summary?.wentWell) summaryRows.push({ label: 'Went well', text: summary.wentWell });
  if (summary?.didNotGoWell) summaryRows.push({ label: "Didn't", text: summary.didNotGoWell });
  if (summary?.architecturalTakeaway)
    summaryRows.push({ label: 'Takeaway', text: summary.architecturalTakeaway });
  const candidateCount = p?.output?.improvementCandidates?.length ?? 0;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <RefreshCw size={13} className="shrink-0 text-purple-400" />
        <span className="font-mono uppercase tracking-wider">Retrospective</span>
        <span
          className={cn(
            'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full',
            tier === 'deep' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400',
          )}
        >
          {tier}
        </span>
        <span
          className={cn(
            'text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-full',
            isSuccess ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400',
          )}
        >
          {outcome}
        </span>
        {candidateCount > 0 && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="text-fg-2">
              {candidateCount} candidate{candidateCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {summaryRows.length > 0 && (
        <ul className="space-y-1 mt-1">
          {summaryRows.map((row) => (
            <li key={row.label} className="flex gap-2 text-[11.5px] text-fg-2 leading-snug">
              <span className="shrink-0 text-fg-5 mt-0.5">–</span>
              <span>
                <span className="text-fg-3">{row.label}</span> — {row.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
