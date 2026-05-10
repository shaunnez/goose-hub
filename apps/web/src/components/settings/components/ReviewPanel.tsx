import { fetchReviewSettings, patchReviewSettings } from '@/lib/api';
import type { ReviewSettingsDto, ReviewerSlot } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Props {
  slug: string;
}

const SLOT_MODELS = ['claude', 'codex'] as const;
const SLOT_PROMPTS = ['default', 'unconstrained'] as const;

const DEFAULT_SLOTS: ReviewerSlot[] = [
  { model: 'claude', prompt: 'default' },
  { model: 'claude', prompt: 'unconstrained' },
];

export function ReviewPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<ReviewSettingsDto>({
    queryKey: ['review-settings', slug],
    queryFn: ({ signal }) => fetchReviewSettings(slug, signal),
    staleTime: 10_000,
  });

  const patch = useMutation({
    mutationFn: (slots: ReviewerSlot[] | null) => patchReviewSettings(slug, slots),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['review-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load review settings.</div>;

  const currentSlots = data.reviewerSlots ?? DEFAULT_SLOTS;
  const isConfigured = data.reviewerSlots != null;

  function updateSlot(idx: number, field: keyof ReviewerSlot, value: string) {
    const next = currentSlots.map((s, i) =>
      i === idx ? { ...s, [field]: value } : s,
    ) as ReviewerSlot[];
    patch.mutate(next);
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Convergent Reviewer Slots
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          Configure up to 2 reviewer slots for the convergent review workflow. Each slot chooses a
          provider (claude or codex) and a prompt variant (default = scoped to acceptance criteria,
          unconstrained = broader critique). Divergent verdicts (approved vs needs-fix) escalate to
          needs-human.
        </p>

        <label className="flex items-center gap-2 text-[12px] mb-4">
          <input
            type="checkbox"
            data-testid="review-configured-toggle"
            checked={isConfigured}
            onChange={(e) => patch.mutate(e.target.checked ? DEFAULT_SLOTS : null)}
            disabled={patch.isPending}
            className="h-4 w-4 rounded border-line"
          />
          <span>Use configured slots (2 reviewer convergent mode)</span>
          {isConfigured ? (
            <span className="text-[11px] text-accent">enabled</span>
          ) : (
            <span className="text-[11px] text-fg-3">defaults</span>
          )}
        </label>

        {isConfigured && (
          <div className="space-y-3">
            {currentSlots.map((slot, idx) => (
              <div
                key={`${slot.model}-${slot.prompt}-${idx}`}
                className="flex items-center gap-3 border border-line rounded px-3 py-2"
              >
                <span className="text-[11px] text-fg-3 w-12">Slot {idx + 1}</span>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-fg-3">Provider</span>
                  <select
                    value={slot.model}
                    onChange={(e) => updateSlot(idx, 'model', e.target.value)}
                    disabled={patch.isPending}
                    className="text-[12px] bg-bg border border-line rounded px-2 py-0.5"
                  >
                    {SLOT_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-fg-3">Prompt</span>
                  <select
                    value={slot.prompt}
                    onChange={(e) => updateSlot(idx, 'prompt', e.target.value)}
                    disabled={patch.isPending}
                    className="text-[12px] bg-bg border border-line rounded px-2 py-0.5"
                  >
                    {SLOT_PROMPTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {data.updatedAt && (
          <p className="text-[10px] text-fg-3 mt-3">
            Last updated {data.updatedAt}
            {data.updatedBy ? ` by ${data.updatedBy}` : ''}
          </p>
        )}
      </section>
    </div>
  );
}
