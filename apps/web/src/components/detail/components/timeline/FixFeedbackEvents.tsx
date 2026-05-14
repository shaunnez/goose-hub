import type { AgentEventDto } from '@/lib/types';
import { CheckCircle, ClipboardCheck } from 'lucide-react';

type FixFeedbackPayload = {
  filesWritten?: number;
  testsWritten?: number;
  confidence?: string;
  repairMode?: string;
  repairCycle?: number;
  affectedWpIds?: string[];
  testsRun?: {
    command?: string;
    paths?: string[];
  };
};

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

export function AgentFixFeedbackCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as FixFeedbackPayload | null;
  const command = p?.testsRun?.command;
  const paths = p?.testsRun?.paths ?? [];
  const title =
    p?.repairMode === 'legacy-implement' && p.repairCycle != null
      ? `Legacy Repair Cycle ${p.repairCycle}`
      : 'Fix feedback complete';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-success bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <ClipboardCheck size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.repairMode === 'legacy-implement' && <span>legacy implement repair</span>}
        {p?.filesWritten != null && (
          <span>
            {p.filesWritten} file{p.filesWritten === 1 ? '' : 's'} written
          </span>
        )}
        {p?.testsWritten != null && (
          <span>
            {p.testsWritten} test{p.testsWritten === 1 ? '' : 's'} written
          </span>
        )}
        {p?.confidence != null && <span>{p.confidence} confidence</span>}
        {p?.affectedWpIds != null && p.affectedWpIds.length > 0 && (
          <span>{p.affectedWpIds.join(', ')}</span>
        )}
      </div>
      {command != null && (
        <div className="mt-2 flex items-start gap-2 text-[11.5px] text-fg-3">
          <CheckCircle size={12} className="mt-0.5 shrink-0 text-green-400" />
          <span className="font-mono break-words">{command}</span>
        </div>
      )}
      {paths.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {paths.map((path) => (
            <span key={path} className="font-mono text-[11px] text-fg-3">
              {path}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
