import { fetchDevReviewSettings, patchDevReviewSettings } from '@/lib/api';
import type { DevReviewSettingsDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Props {
  slug: string;
}

const TRIGGER_ON_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'priority:medium+', label: 'Medium and above' },
  { value: 'priority:high+', label: 'High and above' },
  { value: 'priority:critical', label: 'Critical only' },
] as const;

const DEFAULTS = {
  enabled: false,
  triggerOn: 'priority:high+' as string,
  maxRevisionTurns: 1,
  perCycleMaxUsd: 2.0,
  timeoutMs: 180_000,
};

export function DevReviewPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<DevReviewSettingsDto>({
    queryKey: ['dev-review-settings', slug],
    queryFn: ({ signal }) => fetchDevReviewSettings(slug, signal),
    staleTime: 10_000,
  });

  const patch = useMutation({
    mutationFn: (
      values: Partial<{
        enabled: boolean | null;
        triggerOn: string | null;
        maxRevisionTurns: number | null;
        perCycleMaxUsd: number | null;
        timeoutMs: number | null;
      }>,
    ) => patchDevReviewSettings(slug, values),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['dev-review-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load dev-review settings.</div>;

  const effective = {
    enabled: data.dbOverride?.enabled ?? data.config?.enabled ?? DEFAULTS.enabled,
    triggerOn: data.dbOverride?.triggerOn ?? data.config?.triggerOn ?? DEFAULTS.triggerOn,
    maxRevisionTurns:
      data.dbOverride?.maxRevisionTurns ??
      data.config?.maxRevisionTurns ??
      DEFAULTS.maxRevisionTurns,
    perCycleMaxUsd:
      data.dbOverride?.perCycleMaxUsd ?? data.config?.perCycleMaxUsd ?? DEFAULTS.perCycleMaxUsd,
    timeoutMs: data.dbOverride?.timeoutMs ?? data.config?.timeoutMs ?? DEFAULTS.timeoutMs,
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Dev-Review Advisor
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          Runs a Codex dev-review pass after all work packages are committed, before the PR is
          opened. Blockers trigger a developer response turn; turns loop up to maxRevisionTurns.
          Approved verdict exits early.
        </p>

        {/* enabled toggle */}
        <label className="flex items-center gap-2 text-[12px] mb-5">
          <input
            type="checkbox"
            data-testid="dev-review-enabled-toggle"
            checked={effective.enabled}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
            disabled={patch.isPending}
            className="h-4 w-4 rounded border-line"
          />
          <span>Enable dev-review advisor</span>
          {effective.enabled ? (
            <span className="text-[11px] text-accent">enabled</span>
          ) : (
            <span className="text-[11px] text-fg-3">disabled</span>
          )}
        </label>

        <div className="space-y-4">
          {/* triggerOn */}
          <div className="flex items-center gap-3">
            <label htmlFor="dev-review-trigger-on" className="text-[12px] text-fg-2 w-36 shrink-0">
              Trigger on
            </label>
            <select
              id="dev-review-trigger-on"
              data-testid="dev-review-trigger-on"
              value={effective.triggerOn}
              onChange={(e) => patch.mutate({ triggerOn: e.target.value })}
              disabled={patch.isPending}
              className="text-[12px] bg-bg border border-line rounded px-2 py-0.5"
            >
              {TRIGGER_ON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* maxRevisionTurns */}
          <div className="flex items-center gap-3">
            <label htmlFor="dev-review-max-turns" className="text-[12px] text-fg-2 w-36 shrink-0">
              Max revision turns
            </label>
            <input
              id="dev-review-max-turns"
              type="number"
              data-testid="dev-review-max-turns"
              min={1}
              max={5}
              value={effective.maxRevisionTurns}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (v >= 1 && v <= 5) patch.mutate({ maxRevisionTurns: v });
              }}
              disabled={patch.isPending}
              className="text-[12px] bg-bg border border-line rounded px-2 py-0.5 w-20"
            />
            <span className="text-[11px] text-fg-3">1–5 (each = 1 Codex call)</span>
          </div>

          {/* perCycleMaxUsd */}
          <div className="flex items-center gap-3">
            <label htmlFor="dev-review-budget" className="text-[12px] text-fg-2 w-36 shrink-0">
              Budget per cycle ($)
            </label>
            <input
              id="dev-review-budget"
              type="number"
              data-testid="dev-review-budget"
              min={0}
              max={50}
              step={0.5}
              value={effective.perCycleMaxUsd}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value);
                if (v >= 0 && v <= 50) patch.mutate({ perCycleMaxUsd: v });
              }}
              disabled={patch.isPending}
              className="text-[12px] bg-bg border border-line rounded px-2 py-0.5 w-20"
            />
            <span className="text-[11px] text-fg-3">USD, 0 = skip</span>
          </div>

          {/* timeoutMs */}
          <div className="flex items-center gap-3">
            <label htmlFor="dev-review-timeout" className="text-[12px] text-fg-2 w-36 shrink-0">
              Timeout (ms)
            </label>
            <input
              id="dev-review-timeout"
              type="number"
              data-testid="dev-review-timeout"
              min={30_000}
              max={1_800_000}
              step={30_000}
              value={effective.timeoutMs}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (v >= 30_000 && v <= 1_800_000) patch.mutate({ timeoutMs: v });
              }}
              disabled={patch.isPending}
              className="text-[12px] bg-bg border border-line rounded px-2 py-0.5 w-28"
            />
            <span className="text-[11px] text-fg-3">30 000 – 1 800 000</span>
          </div>
        </div>

        {data.dbOverride?.updatedAt && (
          <p className="text-[10px] text-fg-3 mt-4">
            Last updated {data.dbOverride.updatedAt}
            {data.dbOverride.updatedBy ? ` by ${data.dbOverride.updatedBy}` : ''}
          </p>
        )}

        {data.config == null && data.dbOverride == null && (
          <p className="text-[11px] text-fg-3 mt-3">
            No config block in project.config.ts — all values are DB overrides or defaults.
          </p>
        )}
      </section>
    </div>
  );
}
