import {
  deleteSkillBudgetSetting,
  fetchCodexAuthStatus,
  fetchProjectSettings,
  fetchRuntimeProfiler,
  patchGlobalBudgetSettings,
  patchSkillBudgetSetting,
  resetAllProjectBudgets,
} from '@/lib/api';
import type {
  CodexAuthStatusDto,
  ModelProvider,
  ModelTier,
  ProjectSettingsDto,
  RuntimeEffort,
  RuntimeProfilerDto,
} from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useState } from 'react';

interface Props {
  slug: string;
}

const GLOBAL_FIELDS: Array<{
  key: Exclude<
    keyof NonNullable<ProjectSettingsDto['dbGlobalOverrides']>,
    'updatedAt' | 'updatedBy'
  >;
  label: string;
  configKey: string;
  isFloat?: boolean;
  notYetEnforced?: boolean;
}> = [
  {
    key: 'perWorkflowMaxUsd',
    label: 'Per-workflow max USD',
    configKey: 'perWorkflowMaxUsd',
    isFloat: true,
  },
  {
    key: 'perAgentMaxUsd',
    label: 'Per-agent max USD',
    configKey: 'perAgentMaxUsd',
    isFloat: true,
  },
  {
    key: 'perAdvisorMaxUsd',
    label: 'Per-advisor max USD',
    configKey: 'perAdvisorMaxUsd',
    isFloat: true,
  },
  { key: 'dailyTokens', label: 'Daily tokens', configKey: 'dailyTokens' },
  { key: 'maxParallelAgents', label: 'Max parallel agents', configKey: 'maxParallelAgents' },
  { key: 'maxScoutAgents', label: 'Max scout agents', configKey: 'maxScoutAgents' },
  { key: 'maxRetries', label: 'Max retries', configKey: 'maxRetries' },
  {
    key: 'perBashCommandMaxSeconds',
    label: 'Per-bash-command max seconds',
    configKey: 'perBashCommandMaxSeconds',
    notYetEnforced: true,
  },
];

const TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus'];
const PROVIDERS: ModelProvider[] = ['claude', 'codex'];
const EFFORTS: RuntimeEffort[] = ['low', 'medium', 'high', 'xhigh'];

type ResolvedSkillRuntimeDto = NonNullable<ProjectSettingsDto['resolvedSkillRuntimes']>[string];
type RuntimeAxis = keyof NonNullable<ResolvedSkillRuntimeDto['resolutionTrace']>;

function provenanceSubtitle(
  resolved: ResolvedSkillRuntimeDto | undefined,
  axis: RuntimeAxis,
): string | undefined {
  const decision = resolved?.resolutionTrace?.[axis];
  if (decision == null) return undefined;
  return `from ${decision.source}: ${decision.reason}`;
}

function NumericInput({
  value,
  placeholder,
  isFloat,
  overridden,
  subtitle,
  onCommit,
}: {
  value: number | null;
  placeholder: string;
  isFloat?: boolean;
  overridden: boolean;
  /** UX-3: small subtitle rendered beneath the input (e.g. "default: 25"). */
  subtitle?: string | null;
  onCommit: (val: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');

  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);

  function handleBlur() {
    if (draft === '') {
      onCommit(null);
    } else {
      const n = isFloat ? Number.parseFloat(draft) : Number.parseInt(draft, 10);
      if (!Number.isNaN(n)) onCommit(n);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <input
          type="number"
          step={isFloat ? '0.01' : '1'}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          className={[
            'w-full max-w-28 min-w-0 rounded border px-2 py-0.5 text-[12px] font-mono bg-bg text-fg',
            overridden ? 'border-accent' : 'border-line',
          ].join(' ')}
        />
        {overridden && (
          <span className="shrink-0 text-[10px] text-accent font-medium">override</span>
        )}
      </div>
      {subtitle != null && subtitle !== '' && (
        <span className="text-[10px] text-fg-3 font-mono break-words">{subtitle}</span>
      )}
    </div>
  );
}

function RuntimeSelect({
  value,
  options,
  defaultValue,
  overridden,
  subtitle,
  onCommit,
}: {
  value: string | null;
  options: string[];
  defaultValue?: string;
  overridden: boolean;
  subtitle?: string;
  onCommit: (val: string | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <select
          value={value ?? ''}
          onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
          className={[
            'w-full max-w-24 min-w-0 rounded border px-2 py-0.5 text-[12px] bg-bg text-fg',
            overridden ? 'border-accent' : 'border-line',
          ].join(' ')}
        >
          <option value="">{defaultValue ?? 'default'}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {overridden && (
          <span className="shrink-0 text-[10px] text-accent font-medium">override</span>
        )}
      </div>
      {defaultValue != null && (
        <span className="text-[10px] text-fg-3 font-mono break-words">default: {defaultValue}</span>
      )}
      {subtitle != null && subtitle !== '' && (
        <span className="text-[10px] text-fg-3 font-mono break-words">{subtitle}</span>
      )}
    </div>
  );
}

function RuntimeModelCell({
  value,
}: {
  value: { tier: ModelTier; provider: ModelProvider; modelId: string } | null | undefined;
}) {
  if (value == null) return <span className="text-fg-3">—</span>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-fg break-all leading-snug">{value.modelId}</span>
      <span className="text-[10px] text-fg-3 font-mono break-all">
        {value.provider}:{value.tier}
      </span>
    </div>
  );
}

function SkillRuntimeField({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={[
        'min-w-0 flex flex-col gap-1',
        wide ? 'flex-[1_1_11rem]' : 'flex-[1_1_8rem]',
      ].join(' ')}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-fg-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SkillMetadataLine({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-fg-3 min-w-16">
        {label}
      </span>
      {values.map((value) => (
        <span
          key={value}
          className="min-w-0 break-all rounded border border-line/60 px-1.5 py-0.5 text-[10px] font-mono text-fg-3"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function CodexAuthSection({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery<CodexAuthStatusDto>({
    queryKey: ['codex-auth-status', slug],
    queryFn: ({ signal }) => fetchCodexAuthStatus(slug, signal),
    staleTime: 30_000,
  });
  const [copied, setCopied] = useState(false);

  const command = data?.loginCommand ?? 'codex login';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="mb-4 rounded border border-line/70 bg-bg-2/40 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-2">
            Codex CLI auth
          </h4>
          <p className="mt-0.5 text-[11px] text-fg-3">
            Required for skill rows that select provider <code>codex</code>. Machine-scoped.
          </p>
        </div>
        {isLoading ? (
          <span className="text-[12px] text-fg-3">Checking…</span>
        ) : data?.status === 'connected' ? (
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-success" />
            <span className="shrink-0 text-fg">Connected</span>
            <code className="min-w-0 break-all text-[11px] text-fg-3">{data.authPath}</code>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="inline-block h-2 w-2 rounded-full bg-danger" />
              <span>Not connected</span>
            </div>
            <code className="rounded border border-line bg-bg px-2 py-1 text-[12px]">
              {command}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-fg-3 hover:text-fg"
              title="Copy to clipboard"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeProfilerSection({
  slug,
  settings,
}: {
  slug: string;
  settings: ProjectSettingsDto;
}) {
  const { data, isLoading } = useQuery<RuntimeProfilerDto>({
    queryKey: ['runtime-profiler', slug],
    queryFn: ({ signal }) => fetchRuntimeProfiler(slug, signal),
    staleTime: 60_000,
  });

  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
        Observed runtime profile
      </h3>
      <p className="text-[11px] text-fg-3 mb-4">
        Read-only recommendations from recent run history. Suggested changes are context, not
        auto-applied.
      </p>
      {isLoading ? (
        <div className="border-y border-line px-3 py-4 text-[12px] text-fg-3">
          Loading observed profile…
        </div>
      ) : data == null || data.skills.length === 0 ? (
        <div className="border-y border-line px-3 py-4 text-[12px] text-fg-3">
          No observed runs in the last 14 days.
        </div>
      ) : (
        <div className="border-y border-line text-[12px]">
          {data.skills.slice(0, 12).map((entry) => {
            const current = settings.resolvedSkillRuntimes?.[entry.skill];
            return (
              <div key={entry.skill} className="border-b border-line/50 px-3 py-3 last:border-b-0">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block font-mono text-[12px] text-fg break-all leading-snug">
                      {entry.skill}
                    </span>
                    <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-3">
                      <span>{entry.metrics.runCount} runs</span>
                      <span>p95 ${entry.metrics.p95CostUsd.toFixed(2)}</span>
                      <span>p95 in {entry.metrics.p95InputTokens.toLocaleString()} tok</span>
                      <span>p95 out {entry.metrics.p95OutputTokens.toLocaleString()} tok</span>
                    </div>
                  </div>
                  <div className="min-w-0 text-right text-[11px] text-fg-3">
                    <div>
                      Current:{' '}
                      <span className="font-mono text-fg">
                        {current?.effectiveProvider ?? 'unknown'}:
                        {current?.effectiveTier ?? 'unknown'}
                      </span>
                    </div>
                    <div>
                      Effort:{' '}
                      <span className="font-mono text-fg">
                        {current?.effectiveEffort ?? 'default'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-[11px]">
                  <ProfilerMetric label="timeout" value={entry.metrics.timeoutRate} />
                  <ProfilerMetric label="budget" value={entry.metrics.budgetExceededRate} />
                  <ProfilerMetric label="schema" value={entry.metrics.schemaValidationRetryRate} />
                  <span className="text-fg-3">{entry.metrics.toolCallCount} tool calls</span>
                </div>
                {entry.recommendations.length > 0 && (
                  <div className="mt-2 flex min-w-0 flex-col gap-1">
                    {entry.recommendations.slice(0, 3).map((rec) => (
                      <div key={`${rec.kind}-${rec.summary}`} className="min-w-0 text-[11px]">
                        <span className="font-medium text-fg">{rec.summary}</span>{' '}
                        <span className="text-fg-3">{rec.evidence}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProfilerMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className={value > 0 ? 'text-warning' : 'text-fg-3'}>
      {label} {Math.round(value * 100)}%
    </span>
  );
}

export function ProjectBudgetPanel({ slug }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<ProjectSettingsDto>({
    queryKey: ['project-settings', slug],
    queryFn: ({ signal }) => fetchProjectSettings(slug, signal),
    staleTime: 10_000,
  });

  const patchGlobal = useMutation({
    mutationFn: (patch: Record<string, number | null>) => patchGlobalBudgetSettings(slug, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  const patchSkill = useMutation({
    mutationFn: ({
      skill,
      patch,
    }: {
      skill: string;
      patch: Parameters<typeof patchSkillBudgetSetting>[2];
    }) => patchSkillBudgetSetting(slug, skill, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  const deleteSkill = useMutation({
    mutationFn: (skill: string) => deleteSkillBudgetSetting(slug, skill),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  const resetAll = useMutation({
    mutationFn: () => resetAllProjectBudgets(slug),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load budget settings.</div>;

  const configBudgets = data.configBudgets as Record<string, number>;
  const dbGlobal = data.dbGlobalOverrides;
  const hasAnyOverride = dbGlobal != null || Object.keys(data.dbSkillOverrides ?? {}).length > 0;
  const skillDefaults = data.skillDefaults ?? {};

  function confirmReset() {
    if (!hasAnyOverride) return;
    const ok = window.confirm(
      'Reset all skill runtime overrides for this project? Global caps and every per-skill override will be cleared. The project will fall back to config and skill defaults.',
    );
    if (ok) resetAll.mutate();
  }

  return (
    <div className="space-y-8">
      {/* Global caps */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2">
            Global runtime caps
          </h3>
          {hasAnyOverride && (
            <button
              type="button"
              onClick={confirmReset}
              disabled={resetAll.isPending}
              className="flex items-center gap-1 text-[11px] text-fg-3 hover:text-danger border border-line/60 rounded-full px-2.5 py-0.5 transition-colors disabled:opacity-40"
              title="Clear all skill runtime overrides"
            >
              <RotateCcw size={11} />
              Reset all to defaults
            </button>
          )}
        </div>
        <p className="text-[11px] text-fg-3 mb-4">
          DB overrides win over config file values. Clear a field (leave blank) to revert to config.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 items-start">
          {GLOBAL_FIELDS.map(({ key, label, configKey, isFloat }) => {
            const configVal = configBudgets[configKey];
            const dbVal = dbGlobal?.[key] ?? null;
            const isOverridden = dbVal != null;
            return (
              <Fragment key={key}>
                <span className="text-[12px] text-fg-2 flex items-center gap-1.5 pt-1">
                  {label}
                </span>
                <NumericInput
                  value={dbVal}
                  placeholder={configVal != null ? String(configVal) : '—'}
                  isFloat={isFloat}
                  overridden={isOverridden}
                  subtitle={configVal != null ? `default: ${configVal}` : null}
                  onCommit={(val) => patchGlobal.mutate({ [key]: val })}
                />
              </Fragment>
            );
          })}
        </div>
      </section>

      {/* Per-skill overrides */}
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Skill runtime settings
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          Leave fields blank to inherit from config or skill defaults. Changes take effect on the
          next agent dispatch. Primary, fallback, and advisor are derived read-only values.
        </p>
        <CodexAuthSection slug={slug} />
        <div className="text-[12px] border-y border-line">
          {data.registeredSkills.map((skill) => {
            const row = data.dbSkillOverrides[skill] ?? null;
            const defaults = skillDefaults[skill];
            const metadata = data.skillMetadata?.[skill];
            const resolved = data.resolvedSkillRuntimes?.[skill];
            const hasAny =
              row != null &&
              (row.maxTurns != null ||
                row.maxBudgetUsd != null ||
                row.timeoutMs != null ||
                row.modelTier != null ||
                row.provider != null ||
                row.effort != null);
            return (
              <div
                key={skill}
                className="min-w-0 border-b border-line/50 px-3 py-3 last:border-b-0 hover:bg-bg-hover/60"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block font-mono text-[12px] text-fg break-all leading-snug">
                      {skill}
                    </span>
                    {metadata?.description != null && metadata.description !== '' && (
                      <p className="mt-1 max-w-4xl text-[11px] leading-snug text-fg-2">
                        {metadata.description}
                      </p>
                    )}
                    <div className="mt-2 flex min-w-0 flex-col gap-1">
                      <SkillMetadataLine label="Depends" values={metadata?.dependencies ?? []} />
                      <SkillMetadataLine label="Called on" values={metadata?.callers ?? []} />
                    </div>
                  </div>
                  <div className="flex min-w-6 shrink-0 justify-end">
                    {hasAny && (
                      <button
                        type="button"
                        title="Clear skill overrides"
                        onClick={() => deleteSkill.mutate(skill)}
                        className="text-fg-3 hover:text-danger transition-colors p-0.5 rounded"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex min-w-0 flex-wrap items-start gap-x-5 gap-y-3">
                  <SkillRuntimeField label="Max turns">
                    <NumericInput
                      value={row?.maxTurns ?? null}
                      placeholder={defaults != null ? String(defaults.maxTurns) : 'default'}
                      overridden={row?.maxTurns != null}
                      subtitle={defaults != null ? `default: ${defaults.maxTurns}` : null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { maxTurns: val } })}
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Max budget">
                    <NumericInput
                      value={row?.maxBudgetUsd ?? null}
                      placeholder={defaults != null ? defaults.maxBudgetUsd.toFixed(2) : 'default'}
                      isFloat
                      overridden={row?.maxBudgetUsd != null}
                      subtitle={
                        defaults != null ? `default: $${defaults.maxBudgetUsd.toFixed(2)}` : null
                      }
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { maxBudgetUsd: val } })}
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Timeout">
                    <NumericInput
                      value={row?.timeoutMs ?? null}
                      placeholder={defaults != null ? String(defaults.timeoutMs) : 'default'}
                      overridden={row?.timeoutMs != null}
                      subtitle={defaults != null ? `default: ${defaults.timeoutMs} ms` : null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { timeoutMs: val } })}
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Tier">
                    <RuntimeSelect
                      value={row?.modelTier ?? null}
                      options={TIERS}
                      defaultValue={defaults?.modelTier}
                      overridden={row?.modelTier != null}
                      subtitle={provenanceSubtitle(resolved, 'tier')}
                      onCommit={(val) =>
                        patchSkill.mutate({ skill, patch: { modelTier: val as ModelTier | null } })
                      }
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Provider">
                    <RuntimeSelect
                      value={row?.provider ?? null}
                      options={PROVIDERS}
                      defaultValue={defaults?.modelProvider}
                      overridden={row?.provider != null}
                      subtitle={provenanceSubtitle(resolved, 'provider')}
                      onCommit={(val) =>
                        patchSkill.mutate({
                          skill,
                          patch: { provider: val as ModelProvider | null },
                        })
                      }
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Effort">
                    <RuntimeSelect
                      value={row?.effort ?? null}
                      options={EFFORTS}
                      defaultValue={defaults?.effort ?? undefined}
                      overridden={row?.effort != null}
                      subtitle={
                        [
                          provenanceSubtitle(resolved, 'effort'),
                          (resolved?.effectiveProvider ?? defaults?.modelProvider) === 'claude'
                            ? 'display only for Claude'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' | ') || undefined
                      }
                      onCommit={(val) =>
                        patchSkill.mutate({
                          skill,
                          patch: { effort: val as RuntimeEffort | null },
                        })
                      }
                    />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Primary" wide>
                    <RuntimeModelCell value={resolved?.resolvedPrimary} />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Fallback" wide>
                    <RuntimeModelCell value={resolved?.resolvedFallback} />
                  </SkillRuntimeField>
                  <SkillRuntimeField label="Advisor" wide>
                    <RuntimeModelCell value={resolved?.resolvedAdvisor} />
                  </SkillRuntimeField>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <RuntimeProfilerSection slug={slug} settings={data} />
    </div>
  );
}
