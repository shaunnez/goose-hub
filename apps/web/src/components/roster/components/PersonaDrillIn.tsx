import {
  approveCandidateById,
  fetchPersonaCandidates,
  fetchPersonaRuns,
  rejectCandidateById,
} from '@/lib/api';
import type { ImprovementCandidateDto, PersonaRunDto, PersonaStatDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

interface PersonaDrillInProps {
  persona: PersonaStatDto;
  onClose: () => void;
}

function qualityBar(score: number) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80
      ? 'var(--success, #22c55e)'
      : pct >= 50
        ? 'var(--warning, #f59e0b)'
        : 'var(--danger, #ef4444)';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-bg overflow-hidden">
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 9999 }} />
      </div>
      <span className="text-[11px] font-mono text-fg-3 w-8 text-right">{pct}%</span>
    </div>
  );
}

function RunHistory({ personaName }: { personaName: string }) {
  const { data: runs = [], isLoading } = useQuery<PersonaRunDto[]>({
    queryKey: ['persona-runs', personaName],
    queryFn: () => fetchPersonaRuns(personaName),
  });

  if (isLoading) {
    return <div className="text-[12px] text-fg-4 py-4">Loading run history…</div>;
  }

  if (runs.length === 0) {
    return (
      <div
        data-testid="runs-empty-state"
        className="text-[12px] text-fg-4 py-4 text-center border border-dashed border-line rounded-md"
      >
        No run history recorded yet
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5">
      {runs.map((run) => (
        <li
          key={run.runId}
          className="flex items-center gap-3 px-3 py-2 rounded-md border border-line bg-bg text-[12px]"
        >
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10.5px] uppercase font-mono"
            style={{
              background:
                run.outcome === 'success'
                  ? 'var(--success-soft, #dcfce7)'
                  : 'var(--danger-soft, #fee2e2)',
              color:
                run.outcome === 'success' ? 'var(--success, #15803d)' : 'var(--danger, #dc2626)',
            }}
          >
            {run.outcome}
          </span>
          <span className="flex-1 text-fg-3 truncate">{run.workItemId ?? '—'}</span>
          <span className="text-fg-4 font-mono shrink-0">
            {Math.round(run.qualityScore * 100)}%
          </span>
          <span className="text-fg-4 shrink-0">{new Date(run.createdAt).toLocaleDateString()}</span>
        </li>
      ))}
    </ol>
  );
}

function CandidateRow({
  candidate,
  personaName,
}: {
  candidate: ImprovementCandidateDto;
  personaName: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['persona-candidates', personaName] });

  const approve = useMutation({
    mutationFn: () => approveCandidateById(candidate.id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => rejectCandidateById(candidate.id),
    onSuccess: invalidate,
  });

  return (
    <li
      data-testid="candidate-row"
      className="px-3 py-2 rounded-md border border-line bg-bg text-[12px]"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="px-1.5 py-0.5 rounded text-[10.5px] uppercase font-mono bg-bg-elev text-fg-3 border border-line">
          {candidate.suggestionType}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-[10.5px] uppercase font-mono"
          style={{
            background:
              candidate.status === 'pending' ? 'var(--warning-soft, #fef3c7)' : 'var(--bg-elev)',
            color: candidate.status === 'pending' ? 'var(--warning, #92400e)' : 'var(--fg-3)',
          }}
        >
          {candidate.status}
        </span>
      </div>
      <p className="text-fg leading-snug mb-2">{candidate.suggestionText}</p>
      {candidate.status === 'pending' && (
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="approve-btn"
            onClick={() => approve.mutate()}
            disabled={approve.isPending || reject.isPending}
            className="h-6 px-2.5 rounded text-[11px] border border-line bg-bg text-fg-2 hover:bg-bg-hover disabled:opacity-50"
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            data-testid="reject-btn"
            onClick={() => reject.mutate()}
            disabled={approve.isPending || reject.isPending}
            className="h-6 px-2.5 rounded text-[11px] border border-line bg-bg text-fg-2 hover:bg-bg-hover disabled:opacity-50"
          >
            {reject.isPending ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}
    </li>
  );
}

function CandidatesList({ personaName }: { personaName: string }) {
  const { data: candidates = [], isLoading } = useQuery<ImprovementCandidateDto[]>({
    queryKey: ['persona-candidates', personaName],
    queryFn: () => fetchPersonaCandidates(personaName),
  });

  if (isLoading) {
    return <div className="text-[12px] text-fg-4 py-4">Loading candidates…</div>;
  }

  if (candidates.length === 0) {
    return (
      <div
        data-testid="candidates-empty-state"
        className="text-[12px] text-fg-4 py-4 text-center border border-dashed border-line rounded-md"
      >
        No improvement candidates yet
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {candidates.map((c) => (
        <CandidateRow key={c.id} candidate={c} personaName={personaName} />
      ))}
    </ol>
  );
}

export function PersonaDrillIn({ persona, onClose }: PersonaDrillInProps) {
  return (
    <aside
      data-testid="persona-drill-in"
      className="w-[360px] shrink-0 flex flex-col border-l border-line bg-bg-elev overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-fg truncate">{persona.personaName}</div>
          <div className="text-[11px] text-fg-3 capitalize">{persona.role}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="p-1 rounded hover:bg-bg-hover text-fg-4 hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Stats summary */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-fg-4 mb-2">Quality</h3>
          {qualityBar(persona.avgQualityScore)}
          <div className="flex gap-4 mt-2 text-[11.5px] text-fg-3">
            <span>{persona.runsTotal} total</span>
            <span className="text-[color:var(--success,#22c55e)]">{persona.runsSucceeded} ok</span>
            <span className="text-[color:var(--danger,#ef4444)]">{persona.runsFailed} failed</span>
          </div>
        </section>

        {/* Run history */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-fg-4 mb-2">Run History</h3>
          <RunHistory personaName={persona.personaName} />
        </section>

        {/* Improvement candidates */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-fg-4 mb-2">
            Improvement Candidates
          </h3>
          <CandidatesList personaName={persona.personaName} />
        </section>
      </div>
    </aside>
  );
}
