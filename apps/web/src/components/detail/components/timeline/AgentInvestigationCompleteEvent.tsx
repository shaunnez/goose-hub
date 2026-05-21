import type { AgentEventDto } from '@/lib/types';
import { CheckCircle } from 'lucide-react';

export function AgentInvestigationCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    investigate?: {
      findings?: string;
      confidence?: string;
      keyFiles?: unknown[];
      openQuestions?: string[];
    };
    playwrightRepro?: {
      reproduced?: boolean;
      notes?: string;
      runnerErrors?: string[];
      testErrors?: string[];
    };
  } | null;
  const inv = p?.investigate;
  const confidence = inv?.confidence ?? 'unknown';
  const findingsPreview =
    inv?.findings != null
      ? inv.findings.length > 120
        ? `${inv.findings.slice(0, 119)}…`
        : inv.findings
      : null;
  const keyFileCount = inv?.keyFiles?.length ?? 0;
  const openQuestionCount = inv?.openQuestions?.length ?? 0;
  const repro = p?.playwrightRepro;
  const reproSetupError = repro?.runnerErrors?.find((error) => error.trim().length > 0);
  const reproAssertionError = repro?.testErrors?.find((error) => error.trim().length > 0);
  const reproDetail = compactReproDetail(reproSetupError ?? reproAssertionError ?? repro?.notes);
  const reproDetailLabel =
    reproSetupError != null
      ? 'repro setup failed'
      : reproAssertionError != null
        ? 'repro assertion'
        : 'repro note';

  const confidenceColor =
    confidence === 'high'
      ? 'text-green-400'
      : confidence === 'medium'
        ? 'text-yellow-400'
        : confidence === 'low'
          ? 'text-[color:var(--danger)]'
          : 'text-fg-3';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-info bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Investigation complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className={`font-mono font-medium ${confidenceColor}`}>{confidence} confidence</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {findingsPreview != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{findingsPreview}</p>
      )}
      <div className="flex gap-3 text-[11px] text-fg-3 font-mono">
        {keyFileCount > 0 && (
          <span>
            <span className="text-fg-2">{keyFileCount}</span> key file
            {keyFileCount !== 1 ? 's' : ''}
          </span>
        )}
        {openQuestionCount > 0 && (
          <span className="text-yellow-400">
            {openQuestionCount} open question{openQuestionCount !== 1 ? 's' : ''}
          </span>
        )}
        {repro != null && (
          <span className={repro.reproduced ? 'text-[color:var(--danger)]' : 'text-fg-2'}>
            repro: {repro.reproduced ? 'confirmed' : 'not reproduced'}
          </span>
        )}
      </div>
      {reproDetail != null && !repro?.reproduced && (
        <p className="mt-1.5 text-[11px] text-fg-2 italic">
          <span className="font-mono not-italic text-fg-3">{reproDetailLabel}: </span>
          {reproDetail}
        </p>
      )}
    </li>
  );
}

function compactReproDetail(value: string | undefined): string | null {
  if (value == null) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine == null) return null;
  return firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine;
}
