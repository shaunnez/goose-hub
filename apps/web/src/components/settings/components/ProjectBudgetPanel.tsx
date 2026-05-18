import {
  deleteSkillBudgetSetting,
  fetchProjectSettings,
  patchGlobalBudgetSettings,
  patchSkillBudgetSetting,
  resetAllProjectBudgets,
} from '@/lib/api';
import type { ModelProvider, ModelTier, ProjectSettingsDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

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
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={isFloat ? '0.01' : '1'}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          className={[
            'w-28 rounded border px-2 py-0.5 text-[12px] font-mono bg-bg text-fg',
            overridden ? 'border-accent' : 'border-line',
          ].join(' ')}
        />
        {overridden && <span className="text-[10px] text-accent font-medium">override</span>}
      </div>
      {subtitle != null && subtitle !== '' && (
        <span className="text-[10px] text-fg-3 font-mono">{subtitle}</span>
      )}
    </div>
  );
}

function RuntimeSelect({
  value,
  options,
  defaultValue,
  overridden,
  onCommit,
}: {
  value: string | null;
  options: string[];
  defaultValue?: string;
  overridden: boolean;
  onCommit: (val: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <select
          value={value ?? ''}
          onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
          className={[
            'w-24 rounded border px-2 py-0.5 text-[12px] bg-bg text-fg',
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
        {overridden && <span className="text-[10px] text-accent font-medium">override</span>}
      </div>
      {defaultValue != null && (
        <span className="text-[10px] text-fg-3 font-mono">default: {defaultValue}</span>
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
    <div className="flex flex-col gap-0.5 min-w-32">
      <span className="font-mono text-fg">{value.modelId}</span>
      <span className="text-[10px] text-fg-3 font-mono">
        {value.provider}:{value.tier}
      </span>
    </div>
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
              <>
                <span
                  key={`${key}-label`}
                  className="text-[12px] text-fg-2 flex items-center gap-1.5 pt-1"
                >
                  {label}
                </span>
                <NumericInput
                  key={`${key}-input`}
                  value={dbVal}
                  placeholder={configVal != null ? String(configVal) : '—'}
                  isFloat={isFloat}
                  overridden={isOverridden}
                  subtitle={configVal != null ? `default: ${configVal}` : null}
                  onCommit={(val) => patchGlobal.mutate({ [key]: val })}
                />
              </>
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
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-fg-3 text-left border-b border-line">
              <th className="pb-2 font-medium">Skill</th>
              <th className="pb-2 font-medium px-2">Max turns</th>
              <th className="pb-2 font-medium px-2">Max budget</th>
              <th className="pb-2 font-medium px-2">Timeout</th>
              <th className="pb-2 font-medium px-2">Tier</th>
              <th className="pb-2 font-medium px-2">Provider</th>
              <th className="pb-2 font-medium px-2">Primary</th>
              <th className="pb-2 font-medium px-2">Fallback</th>
              <th className="pb-2 font-medium px-2">Advisor</th>
              <th className="pb-2 w-6" />
            </tr>
          </thead>
          <tbody>
            {data.registeredSkills.map((skill) => {
              const row = data.dbSkillOverrides[skill] ?? null;
              const defaults = skillDefaults[skill];
              const resolved = data.resolvedSkillRuntimes?.[skill];
              const hasAny =
                row != null &&
                (row.maxTurns != null ||
                  row.maxBudgetUsd != null ||
                  row.timeoutMs != null ||
                  row.modelTier != null ||
                  row.provider != null);
              return (
                <tr key={skill} className="border-b border-line/50 hover:bg-bg-hover align-top">
                  <td className="py-1.5 font-mono text-fg whitespace-nowrap">{skill}</td>
                  <td className="py-1.5 px-2">
                    <NumericInput
                      value={row?.maxTurns ?? null}
                      placeholder={defaults != null ? String(defaults.maxTurns) : 'default'}
                      overridden={row?.maxTurns != null}
                      subtitle={defaults != null ? `default: ${defaults.maxTurns}` : null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { maxTurns: val } })}
                    />
                  </td>
                  <td className="py-1.5 px-2">
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
                  </td>
                  <td className="py-1.5 px-2">
                    <NumericInput
                      value={row?.timeoutMs ?? null}
                      placeholder={defaults != null ? String(defaults.timeoutMs) : 'default'}
                      overridden={row?.timeoutMs != null}
                      subtitle={defaults != null ? `default: ${defaults.timeoutMs} ms` : null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { timeoutMs: val } })}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <RuntimeSelect
                      value={row?.modelTier ?? null}
                      options={TIERS}
                      defaultValue={defaults?.modelTier}
                      overridden={row?.modelTier != null}
                      onCommit={(val) =>
                        patchSkill.mutate({ skill, patch: { modelTier: val as ModelTier | null } })
                      }
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <RuntimeSelect
                      value={row?.provider ?? null}
                      options={PROVIDERS}
                      defaultValue={defaults?.modelProvider}
                      overridden={row?.provider != null}
                      onCommit={(val) =>
                        patchSkill.mutate({
                          skill,
                          patch: { provider: val as ModelProvider | null },
                        })
                      }
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <RuntimeModelCell value={resolved?.resolvedPrimary} />
                  </td>
                  <td className="py-1.5 px-2">
                    <RuntimeModelCell value={resolved?.resolvedFallback} />
                  </td>
                  <td className="py-1.5 px-2">
                    <RuntimeModelCell value={resolved?.resolvedAdvisor} />
                  </td>
                  <td className="py-1.5 pl-1">
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
