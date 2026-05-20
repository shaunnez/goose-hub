import { fetchLearningLoopSettings, patchLearningLoopSettings } from '@/lib/api';
import type { LearningLoopSettingsDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface Props {
  slug: string;
}

function NumberPolicyInput({
  label,
  testId,
  value,
  defaultValue,
  overridden,
  step,
  min,
  max,
  disabled,
  onCommit,
  onReset,
}: {
  label: string;
  testId: string;
  value: number;
  defaultValue: number;
  overridden: boolean;
  step: string;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number | null) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function handleBlur() {
    if (draft === '') {
      if (overridden) onCommit(null);
      return;
    }
    const next = step.includes('.') ? Number.parseFloat(draft) : Number.parseInt(draft, 10);
    if (!Number.isNaN(next) && next !== value) onCommit(next);
  }

  return (
    <label className="flex min-w-0 flex-col gap-1 text-[12.5px]">
      <span className="text-[10px] font-medium uppercase tracking-wider text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <input
          type="number"
          data-testid={testId}
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleBlur}
          className={[
            'w-32 rounded border bg-bg px-2 py-1 text-[12px] font-mono text-fg',
            overridden ? 'border-accent' : 'border-line',
          ].join(' ')}
        />
        {overridden && <span className="text-[10px] font-medium text-accent">override</span>}
        {overridden && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            className="text-[10px] text-fg-3 underline-offset-2 hover:text-fg hover:underline disabled:opacity-40"
          >
            Reset
          </button>
        )}
      </div>
      <span className="text-[10px] text-fg-3 font-mono">default: {defaultValue}</span>
    </label>
  );
}

export function LearningLoopPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<LearningLoopSettingsDto>({
    queryKey: ['learning-loop-settings', slug],
    queryFn: ({ signal }) => fetchLearningLoopSettings(slug, signal),
    staleTime: 10_000,
  });

  const patch = useMutation({
    mutationFn: (next: Parameters<typeof patchLearningLoopSettings>[1]) =>
      patchLearningLoopSettings(slug, next),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['learning-loop-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return (
      <div className="text-[12px] text-danger py-4">Failed to load learning loop settings.</div>
    );

  const overrides = data.dbOverrides;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Skill-Coach Auto-Dispatch
        </h3>
        <p className="text-[11px] text-fg-3 mb-4 max-w-3xl">
          Controls whether cross-run retrospectives can dispatch skill-coach for convergent
          skill-prompt, skill-schema, or skill-config candidates. The coach only creates proposed
          diffs for human review; it never applies changes automatically.
        </p>
        <label className="flex items-center gap-2 text-[12.5px] mb-4">
          <input
            type="checkbox"
            data-testid="coach-policy-enabled-toggle"
            checked={data.coachPolicy.enabled}
            onChange={(event) => patch.mutate({ enabled: event.target.checked })}
            disabled={patch.isPending}
            className="h-4 w-4 rounded border-line"
          />
          <span className="font-mono">coachPolicy.enabled</span>
          {data.coachPolicy.enabled ? (
            <span className="text-[11px] text-accent">enabled</span>
          ) : (
            <span className="text-[11px] text-fg-3">disabled</span>
          )}
          {overrides?.enabled != null && (
            <span className="text-[10px] font-medium text-accent">override</span>
          )}
          {overrides?.enabled != null && (
            <button
              type="button"
              onClick={() => patch.mutate({ enabled: null })}
              disabled={patch.isPending}
              className="text-[10px] text-fg-3 underline-offset-2 hover:text-fg hover:underline disabled:opacity-40"
            >
              Reset
            </button>
          )}
        </label>
        <div className="flex min-w-0 flex-wrap gap-5">
          <NumberPolicyInput
            label="Minimum lifecycles"
            testId="coach-policy-min-lifecycles-input"
            value={data.coachPolicy.minLifecycles}
            defaultValue={data.configDefaults.minLifecycles}
            overridden={overrides?.minLifecycles != null}
            min={1}
            max={100}
            step="1"
            disabled={patch.isPending}
            onCommit={(minLifecycles) => patch.mutate({ minLifecycles })}
            onReset={() => patch.mutate({ minLifecycles: null })}
          />
          <NumberPolicyInput
            label="Consistency threshold"
            testId="coach-policy-consistency-threshold-input"
            value={data.coachPolicy.consistencyThreshold}
            defaultValue={data.configDefaults.consistencyThreshold}
            overridden={overrides?.consistencyThreshold != null}
            min={0}
            max={1}
            step="0.01"
            disabled={patch.isPending}
            onCommit={(consistencyThreshold) => patch.mutate({ consistencyThreshold })}
            onReset={() => patch.mutate({ consistencyThreshold: null })}
          />
        </div>
      </section>
    </div>
  );
}
