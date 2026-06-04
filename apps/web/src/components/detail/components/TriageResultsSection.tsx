import { fetchTriageResult, setRepoOverride } from '@/lib/api';
import { PRIORITY_BG, PRIORITY_BORDER, PRIORITY_COLOR } from '@/lib/constants';
import type { TriageResultDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Folder, Plus, ScanSearch } from 'lucide-react';
import { useState } from 'react';

interface TriageResultsSectionProps {
  projectSlug: string;
  id: string;
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? 'var(--accent)' : pct >= 40 ? 'oklch(0.74 0.15 200)' : 'var(--fg-4)';
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-9 h-1 rounded-full bg-line overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[11.5px] text-fg-2 tabular-nums w-7 text-right">{pct}</span>
    </div>
  );
}

export function TriageResultsSection({ projectSlug, id }: TriageResultsSectionProps) {
  const queryClient = useQueryClient();
  const [overrideMode, setOverrideMode] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState('');

  const { data, isLoading } = useQuery<TriageResultDto | null>({
    queryKey: ['triage', projectSlug, id],
    queryFn: () => fetchTriageResult(projectSlug, id),
  });

  const overrideMutation = useMutation({
    mutationFn: (repo: string) => setRepoOverride(projectSlug, id, repo),
    onSuccess: (updated) => {
      queryClient.setQueryData(['triage', projectSlug, id], updated);
      setSelectedRepo('');
      setOverrideMode(false);
    },
  });

  if (isLoading) {
    return (
      <div data-testid="triage-results-section" className="px-8 py-6 ">
        <div className="h-8 w-32 rounded bg-bg-elev animate-pulse mb-4" />
        <div className="rounded-lg border border-line bg-bg-elev h-48 animate-pulse" />
      </div>
    );
  }

  if (data == null) {
    return (
      <div data-testid="triage-empty-state" className="px-8 py-6 flex flex-col gap-5">
        {/* Section header */}
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">02. Triage</div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Repo candidates &amp; classification
          </h2>
        </div>

        {/* Empty body */}
        <div className="flex flex-col items-center justify-center gap-4 py-14 rounded-lg border border-dashed border-line bg-bg-elev/20 text-center">
          <div className="w-10 h-10 rounded-full bg-bg-elev flex items-center justify-center">
            <ScanSearch size={20} className="text-fg-2" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-medium text-fg-3">No triage result yet</p>
            <p
              data-testid="triage-empty-description"
              className="text-[12px] text-fg-2 max-w-xs leading-snug"
            >
              The triager agent classifies this issue and identifies candidate repositories.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const triage: TriageResultDto = data;
  const pickedRepo = triage.overrideRepo ?? triage.candidates[0]?.repo;
  const overrideRepos = triage.repositories ?? [];

  const priorityColor = PRIORITY_COLOR[triage.priority];
  const priorityBg = PRIORITY_BG[triage.priority];
  const priorityBorder = PRIORITY_BORDER[triage.priority];

  return (
    <div data-testid="triage-results-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">02. Triage</div>
        <h2 className="text-[17px] font-semibold text-fg leading-snug">
          Repo candidates &amp; classification
        </h2>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border"
            style={{
              color: priorityColor,
              background: priorityBg,
              borderColor: priorityBorder,
            }}
          >
            {triage.priority}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border border-line bg-bg-elev text-fg-2">
            {triage.type}
          </span>
        </div>
      </div>

      {/* Candidates table */}
      {triage.candidates.length > 0 && (
        <div className="rounded-lg border border-line overflow-hidden">
          {/* Table header */}
          <div
            className="grid text-[10.5px] uppercase tracking-wider text-fg-2 font-semibold bg-bg-elev-2 px-4 py-2.5 border-b border-line"
            style={{ gridTemplateColumns: '1fr 100px 60px 1.4fr 80px' }}
          >
            <span>Repository</span>
            <span className="text-right">Confidence</span>
            <span className="text-right">Tier</span>
            <span className="pl-4">Evidence</span>
            <span className="text-right">Pick</span>
          </div>

          {/* Rows */}
          {triage.candidates.map((c, i) => {
            const isPicked = c.repo === pickedRepo;
            const isLast = i === triage.candidates.length - 1;
            return (
              <div
                key={c.repo}
                className="grid px-4 py-3 items-center text-[13px] transition-colors"
                style={{
                  gridTemplateColumns: '1fr 100px 60px 1.4fr 80px',
                  background: isPicked ? 'var(--accent-soft)' : 'transparent',
                  borderBottom: isLast ? 'none' : '1px solid var(--line)',
                }}
              >
                {/* Repo name */}
                <div className="flex items-center gap-2 min-w-0">
                  <Folder
                    size={13}
                    className="shrink-0"
                    style={{ color: isPicked ? 'var(--accent)' : 'var(--fg-4)' }}
                  />
                  <span className="font-mono truncate" style={{ fontWeight: isPicked ? 500 : 400 }}>
                    {c.repo}
                  </span>
                </div>

                {/* Confidence bar */}
                <ScoreBar value={c.confidence} />

                {/* Tier */}
                <div className="text-right font-mono text-[11.5px] text-fg-3 tabular-nums">
                  {c.tier != null ? `T${c.tier}` : '—'}
                </div>

                {/* Evidence */}
                <div className="pl-4 text-[12px] text-fg-3 leading-snug">{c.evidence}</div>

                {/* Pick indicator */}
                <div className="flex justify-end">
                  {isPicked ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-accent/15 text-accent border border-accent/30">
                      <Check size={10} strokeWidth={2.5} />
                      picked
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-fg-5 tabular-nums">
                      {c.confidence}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2">
        <span className="grow" />
        {overrideMode ? (
          <>
            <select
              data-testid="repo-override-select"
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="text-[12px] bg-bg-elev border border-line rounded-md px-2 py-1.5 text-fg-2 focus:outline-none focus:border-accent"
            >
              <option value="">Select repo to override…</option>
              {overrideRepos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              data-testid="repo-override-button"
              type="button"
              disabled={selectedRepo === '' || overrideMutation.isPending}
              onClick={() => {
                if (selectedRepo) overrideMutation.mutate(selectedRepo);
              }}
              className="h-7 px-3 rounded-md text-[12px] bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Set repo
            </button>
            <button
              type="button"
              onClick={() => {
                setOverrideMode(false);
                setSelectedRepo('');
              }}
              className="h-7 px-3 rounded-md text-[12px] border border-line text-fg-3 hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="h-7 px-3 rounded-md text-[12px] border border-line text-fg-2 hover:bg-bg-hover transition-colors inline-flex items-center gap-1.5"
            >
              <Plus size={11} />
              Add candidate
            </button>
            <button
              type="button"
              onClick={() => setOverrideMode(true)}
              className="h-7 px-3 rounded-md text-[12px] border border-line text-fg-2 hover:bg-bg-hover transition-colors"
            >
              Override pick
            </button>
          </>
        )}
      </div>
    </div>
  );
}
