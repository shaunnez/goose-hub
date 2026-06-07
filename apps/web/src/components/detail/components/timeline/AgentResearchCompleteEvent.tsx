import type { AgentEventDto } from '@/lib/types';
import { CheckCircle } from 'lucide-react';

export function AgentResearchCompleteEvent({ event }: { event: AgentEventDto }) {
  const payload = event.payload as {
    research?: {
      actionability?: string;
      answer?: string;
      evidence?: unknown[];
      options?: unknown[];
      followUpWork?: Array<{ actionable?: boolean }>;
      openQuestions?: string[];
    };
    finalRouting?: string;
  } | null;
  const research = payload?.research;
  const actionability = research?.actionability ?? 'unknown';
  const answerPreview = compactText(research?.answer, 180);
  const evidenceCount = research?.evidence?.length ?? 0;
  const optionCount = research?.options?.length ?? 0;
  const actionableFollowUpCount =
    research?.followUpWork?.filter((candidate) => candidate.actionable === true).length ?? 0;
  const openQuestionCount = research?.openQuestions?.length ?? 0;

  const actionabilityColor =
    actionability === 'directly-actionable'
      ? 'text-green-400'
      : actionability === 'blocked'
        ? 'text-[color:var(--danger)]'
        : actionability === 'ambiguous'
          ? 'text-yellow-400'
          : 'text-fg-3';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-info bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3 flex-wrap">
        <CheckCircle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Research complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className={`font-mono font-medium ${actionabilityColor}`}>{actionability}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
        {payload?.finalRouting != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono text-fg-2">{payload.finalRouting}</span>
          </>
        )}
      </div>
      {answerPreview != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{answerPreview}</p>
      )}
      <div className="flex gap-3 text-[11px] text-fg-3 font-mono flex-wrap">
        <span>
          <span className="text-fg-2">{evidenceCount}</span> evidence
        </span>
        <span>
          <span className="text-fg-2">{optionCount}</span> option{optionCount !== 1 ? 's' : ''}
        </span>
        <span>
          <span className="text-fg-2">{actionableFollowUpCount}</span> actionable follow-up
          {actionableFollowUpCount !== 1 ? 's' : ''}
        </span>
        {openQuestionCount > 0 && (
          <span className="text-yellow-400">
            {openQuestionCount} open question{openQuestionCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </li>
  );
}

function compactText(value: string | undefined, maxLength: number): string | null {
  if (value == null) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized === '') return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
