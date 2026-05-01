import { fetchTriageResult, setRepoOverride } from '@/lib/api';
import type { TriageResultDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface TriageResultsSectionProps {
  projectSlug: string;
  id: string;
}

const TYPE_COLOR: Record<string, string> = {
  feature: 'bg-blue-500/15 text-blue-400',
  bug: 'bg-red-500/15 text-red-400',
  chore: 'bg-gray-500/15 text-gray-400',
  research: 'bg-purple-500/15 text-purple-400',
};

const PRIORITY_COLOR: Record<string, string> = {
  p0: 'bg-red-600/20 text-red-400',
  p1: 'bg-orange-500/20 text-orange-400',
  p2: 'bg-yellow-500/20 text-yellow-400',
  p3: 'bg-gray-500/15 text-gray-400',
  critical: 'bg-red-600/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-gray-500/15 text-gray-400',
};

// Static allowlist — mirrors target-projects/goose-hub-self/repos.md
const ALLOWLISTED_REPOS = ['shaunnez/goose-hub'];

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${colorClass}`}
    >
      {label}
    </span>
  );
}

export function TriageResultsSection({ projectSlug, id }: TriageResultsSectionProps) {
  const queryClient = useQueryClient();
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
    },
  });

  if (isLoading || data == null) return null;

  const triage: TriageResultDto = data;

  return (
    <div data-testid="triage-results-section" className="px-8 py-4 border-t border-border/40">
      <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide mb-3">Triage</h3>
      <div className="flex items-center gap-2 mb-4">
        <Badge
          label={triage.type}
          colorClass={TYPE_COLOR[triage.type] ?? 'bg-gray-500/15 text-gray-400'}
        />
        <Badge
          label={triage.priority}
          colorClass={PRIORITY_COLOR[triage.priority] ?? 'bg-gray-500/15 text-gray-400'}
        />
      </div>

      {triage.candidates.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-medium text-fg-3 mb-2">Repo candidates</p>
          <ul className="space-y-1">
            {triage.candidates.map((c) => (
              <li
                key={c.repo}
                className={`text-[12px] flex items-start gap-2 ${triage.overrideRepo === c.repo ? 'text-fg-1 font-medium' : 'text-fg-2'}`}
              >
                <span className="font-mono">{c.repo}</span>
                <span className="text-fg-3">
                  {c.confidence}% · {c.evidence} · tier {c.tier}
                  {triage.overrideRepo === c.repo && (
                    <span className="ml-1 text-blue-400">(confirmed)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <select
          data-testid="repo-override-select"
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
          className="text-[12px] bg-surface-2 border border-border/60 rounded px-2 py-1 text-fg-2 focus:outline-none focus:border-border"
        >
          <option value="">Select repo to override…</option>
          {ALLOWLISTED_REPOS.map((r) => (
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
          className="text-[12px] px-3 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Set repo
        </button>
      </div>
    </div>
  );
}
