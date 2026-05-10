import {
  deleteSkillBudgetSetting,
  fetchProjectSettings,
  patchGlobalBudgetSettings,
  patchSkillBudgetSetting,
} from '@/lib/api';
import type { ProjectSettingsDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
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
  { key: 'maxRetries', label: 'Max retries', configKey: 'maxRetries' },
  {
    key: 'perBashCommandMaxSeconds',
    label: 'Per-bash-command max seconds',
    configKey: 'perBashCommandMaxSeconds',
    notYetEnforced: true,
  },
];

function NumericInput({
  value,
  placeholder,
  isFloat,
  overridden,
  onCommit,
}: {
  value: number | null;
  placeholder: string;
  isFloat?: boolean;
  overridden: boolean;
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
    <div className="relative flex items-center gap-1">
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
    mutationFn: ({ skill, patch }: { skill: string; patch: Record<string, number | null> }) =>
      patchSkillBudgetSetting(slug, skill, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  const deleteSkill = useMutation({
    mutationFn: (skill: string) => deleteSkillBudgetSetting(slug, skill),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load budget settings.</div>;

  const configBudgets = data.configBudgets as Record<string, number>;
  const dbGlobal = data.dbGlobalOverrides;

  return (
    <div className="space-y-8">
      {/* Global caps */}
      <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-3">
          Global budget caps
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          DB overrides win over config file values. Clear a field (leave blank) to revert to config.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 items-center">
          {GLOBAL_FIELDS.map(({ key, label, configKey, isFloat }) => {
            const configVal = configBudgets[configKey];
            const dbVal = dbGlobal?.[key] ?? null;
            const isOverridden = dbVal != null;
            return (
              <>
                <span
                  key={`${key}-label`}
                  className="text-[12px] text-fg-2 flex items-center gap-1.5"
                >
                  {label}
                </span>
                <NumericInput
                  key={`${key}-input`}
                  value={dbVal}
                  placeholder={configVal != null ? String(configVal) : '—'}
                  isFloat={isFloat}
                  overridden={isOverridden}
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
          Per-skill budget overrides
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          Leave fields blank to inherit from config or SKILL_BUDGETS defaults. Changes take effect
          on the next agent dispatch.
        </p>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-fg-3 text-left border-b border-line">
              <th className="pb-2 font-medium">Skill</th>
              <th className="pb-2 font-medium px-2">Max turns</th>
              <th className="pb-2 font-medium px-2">Max budget (USD)</th>
              <th className="pb-2 font-medium px-2">Timeout (ms)</th>
              <th className="pb-2 w-6" />
            </tr>
          </thead>
          <tbody>
            {data.registeredSkills.map((skill) => {
              const row = data.dbSkillOverrides[skill] ?? null;
              const hasAny =
                row != null &&
                (row.maxTurns != null || row.maxBudgetUsd != null || row.timeoutMs != null);
              return (
                <tr key={skill} className="border-b border-line/50 hover:bg-bg-hover">
                  <td className="py-1.5 font-mono text-fg">{skill}</td>
                  <td className="py-1.5 px-2">
                    <NumericInput
                      value={row?.maxTurns ?? null}
                      placeholder="default"
                      overridden={row?.maxTurns != null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { maxTurns: val } })}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <NumericInput
                      value={row?.maxBudgetUsd ?? null}
                      placeholder="default"
                      isFloat
                      overridden={row?.maxBudgetUsd != null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { maxBudgetUsd: val } })}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <NumericInput
                      value={row?.timeoutMs ?? null}
                      placeholder="default"
                      overridden={row?.timeoutMs != null}
                      onCommit={(val) => patchSkill.mutate({ skill, patch: { timeoutMs: val } })}
                    />
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
