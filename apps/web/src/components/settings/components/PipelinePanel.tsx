import { fetchPipelineSettings, patchPipelineSettings } from '@/lib/api';
import type { PipelineSettingsDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Props {
  slug: string;
}

export function PipelinePanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<PipelineSettingsDto>({
    queryKey: ['pipeline-settings', slug],
    queryFn: ({ signal }) => fetchPipelineSettings(slug, signal),
    staleTime: 10_000,
  });

  const patch = useMutation({
    mutationFn: (next: boolean) => patchPipelineSettings(slug, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pipeline-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load pipeline settings.</div>;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Multi-Agent Pipeline
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          Toggle the multi-agent pipeline (spec-author, parallel-implement, convergent review,
          merge-decision gate). When off, the legacy single-agent fix-issue → QA → review path runs.
        </p>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            data-testid="use-m19-pipeline-toggle"
            checked={data.useM19Pipeline}
            onChange={(e) => patch.mutate(e.target.checked)}
            disabled={patch.isPending}
            className="h-4 w-4 rounded border-line"
          />
          <span className="font-mono">useM19Pipeline</span>
          {data.useM19Pipeline ? (
            <span className="text-[11px] text-accent">enabled</span>
          ) : (
            <span className="text-[11px] text-fg-3">disabled</span>
          )}
        </label>
      </section>
    </div>
  );
}
