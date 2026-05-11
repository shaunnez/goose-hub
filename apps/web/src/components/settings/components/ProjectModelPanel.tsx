import {
  deleteRoleModelSetting,
  fetchCodexAuthStatus,
  fetchDevReviewSettings,
  fetchProjectModelSettings,
  patchComplexityOverrides,
  patchDevReviewSettings,
  patchRoleModelSetting,
} from '@/lib/api';
import type {
  CodexAuthStatusDto,
  DevReviewSettingsDto,
  ModelTier,
  ProjectModelSettingsDto,
  RoleModelDto,
} from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  slug: string;
}

const TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus'];
// Mirrors HOLDOUT_ROLES in core/agent-runtime/roles.ts. Duplicated here because
// apps/web does not import @goose-hub/core (would pull server-only modules into
// the React bundle). Keep in sync if the canonical set changes.
const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);

const COMPLEXITY_KEY_OPTIONS = [
  { value: 'type:bug', label: 'type: bug' },
  { value: 'type:feature', label: 'type: feature' },
  { value: 'type:chore', label: 'type: chore' },
  { value: 'type:research', label: 'type: research' },
  { value: 'priority:low', label: 'priority: low' },
  { value: 'priority:medium', label: 'priority: medium' },
  { value: 'priority:high', label: 'priority: high' },
  { value: 'priority:critical', label: 'priority: critical' },
  { value: 'default', label: 'default (all others)' },
];

function TierSelect({
  value,
  overridden,
  placeholder,
  disabled,
  onChange,
}: {
  value: ModelTier | null;
  overridden: boolean;
  placeholder: string;
  disabled?: boolean;
  onChange: (val: ModelTier | null) => void;
}) {
  return (
    <div className="relative flex items-center gap-1">
      <select
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : (v as ModelTier));
        }}
        className={[
          'rounded border px-2 py-0.5 text-[12px] bg-bg text-fg appearance-none pr-6',
          overridden ? 'border-accent' : 'border-line',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <option value="">{placeholder}</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {overridden && <span className="text-[10px] text-accent font-medium shrink-0">override</span>}
    </div>
  );
}

function ComplexityEditor({
  role,
  slug,
  overrides,
  onSave,
}: {
  role: string;
  slug: string;
  overrides: Record<string, ModelTier>;
  onSave: () => void;
}) {
  const [newKey, setNewKey] = useState('type:bug');
  const [newTier, setNewTier] = useState<ModelTier>('haiku');

  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (next: Record<string, ModelTier>) => patchComplexityOverrides(slug, role, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-model-settings', slug] });
      onSave();
    },
  });

  function addRule() {
    patch.mutate({ ...overrides, [newKey]: newTier });
  }

  function removeRule(key: string) {
    const next = { ...overrides };
    delete next[key];
    patch.mutate(next);
  }

  return (
    <div className="mt-2 ml-4 border-l-2 border-line pl-4 space-y-2">
      <p className="text-[11px] text-fg-3">
        Complexity rules override model tier per issue type/priority. DB rules win over config file.
      </p>
      {Object.entries(overrides).map(([key, tier]) => (
        <div key={key} className="flex items-center gap-2 text-[12px]">
          <span className="font-mono text-fg-2 w-40 shrink-0">{key}</span>
          <span className="text-fg">→</span>
          <span className="font-mono text-accent">{tier}</span>
          <button
            type="button"
            onClick={() => removeRule(key)}
            className="text-fg-3 hover:text-danger transition-colors p-0.5"
            title="Remove rule"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="rounded border border-line px-2 py-0.5 text-[12px] bg-bg text-fg"
        >
          {COMPLEXITY_KEY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-fg-2">→</span>
        <select
          value={newTier}
          onChange={(e) => setNewTier(e.target.value as ModelTier)}
          className="rounded border border-line px-2 py-0.5 text-[12px] bg-bg text-fg"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addRule}
          disabled={patch.isPending}
          className="flex items-center gap-0.5 text-[11px] text-accent hover:text-fg transition-colors border border-accent/40 rounded px-1.5 py-0.5"
        >
          <Plus size={10} />
          Add
        </button>
      </div>
    </div>
  );
}

function RoleRow({
  role,
  slug,
  data,
  allowHoldoutOverride,
}: {
  role: string;
  slug: string;
  data: RoleModelDto;
  allowHoldoutOverride: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const isHoldout = HOLDOUT_ROLES.has(role);
  const locked = isHoldout && !allowHoldoutOverride;

  const patchRole = useMutation({
    mutationFn: (patch: {
      primaryModel?: ModelTier | null;
      fallbackModel?: ModelTier | null;
      advisorModel?: ModelTier | null;
    }) => patchRoleModelSetting(slug, role, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project-model-settings', slug] }),
  });

  const clearRole = useMutation({
    mutationFn: () => deleteRoleModelSetting(slug, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project-model-settings', slug] }),
  });

  const db = data.dbRoleModel;
  const hasDbOverride =
    db != null && (db.primaryModel != null || db.fallbackModel != null || db.advisorModel != null);
  const hasComplexity = Object.keys(data.dbComplexityOverrides).length > 0;

  const configPrimary = (data.configRoleModel?.primary as ModelTier) ?? null;

  return (
    <>
      <tr className="border-b border-line/50 hover:bg-bg-hover">
        <td className="py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 font-mono text-fg text-[12px]"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {role}
            {isHoldout && (
              <span className="text-[9px] uppercase tracking-wider font-medium text-fg-3 border border-line rounded px-1">
                holdout
              </span>
            )}
          </button>
        </td>
        <td className="py-1.5 px-2">
          <TierSelect
            value={db?.primaryModel ?? null}
            overridden={db?.primaryModel != null}
            placeholder={configPrimary ?? 'skill default'}
            disabled={locked}
            onChange={(val) => patchRole.mutate({ primaryModel: val })}
          />
        </td>
        <td className="py-1.5 px-2">
          <TierSelect
            value={db?.fallbackModel ?? null}
            overridden={db?.fallbackModel != null}
            placeholder={data.configRoleModel?.fallback ?? '—'}
            disabled={locked}
            onChange={(val) => patchRole.mutate({ fallbackModel: val })}
          />
        </td>
        <td className="py-1.5 px-2">
          <TierSelect
            value={db?.advisorModel ?? null}
            overridden={db?.advisorModel != null}
            placeholder={data.configRoleModel?.advisor ?? '—'}
            disabled={locked}
            onChange={(val) => patchRole.mutate({ advisorModel: val })}
          />
        </td>
        <td className="py-1.5 pl-1">
          {(hasDbOverride || hasComplexity) && (
            <button
              type="button"
              title="Clear all overrides for this role"
              onClick={() => clearRole.mutate()}
              className="text-fg-3 hover:text-danger transition-colors p-0.5 rounded"
            >
              <Trash2 size={11} />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line/30">
          <td colSpan={5} className="py-2 px-2">
            {locked ? (
              <p className="text-[11px] text-fg-3 ml-4">
                Holdout role — set <code>agentConfig.allowHoldoutOverride: true</code> in project
                config to enable overrides.
              </p>
            ) : (
              <ComplexityEditor
                role={role}
                slug={slug}
                overrides={data.dbComplexityOverrides}
                onSave={() => setExpanded(true)}
              />
            )}
          </td>
        </tr>
      )}
    </>
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
    <div>
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-1">
        Codex CLI auth
      </h3>
      <p className="text-[11px] text-fg-3 mb-3">
        OpenAI Codex CLI uses OAuth ("Sign in with ChatGPT"). Required to run any skill with{' '}
        <code>provider: 'codex'</code>. Status is per-machine, not per-project.
      </p>
      {isLoading ? (
        <div className="text-[12px] text-fg-3">Checking…</div>
      ) : data?.status === 'connected' ? (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="inline-block w-2 h-2 rounded-full bg-success" />
          <span>Connected</span>
          <span className="text-fg-3">
            — token at <code>{data.authPath}</code>
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="inline-block w-2 h-2 rounded-full bg-danger" />
            <span>Not connected</span>
          </div>
          <div className="text-[12px] text-fg-3">
            Run the command below in your terminal to sign in:
          </div>
          <div className="flex items-center gap-2">
            <code className="text-[12px] bg-bg-2 border border-line rounded px-2 py-1">
              {command}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 text-[11px] text-fg-3 hover:text-fg border border-line rounded px-2 py-1"
              title="Copy to clipboard"
            >
              <Copy className="w-3 h-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const TRIGGER_ON_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'priority:medium+', label: 'Medium and above' },
  { value: 'priority:high+', label: 'High and above' },
  { value: 'priority:critical', label: 'Critical only' },
] as const;

function DevReviewSection({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<DevReviewSettingsDto>({
    queryKey: ['dev-review-settings', slug],
    queryFn: ({ signal }) => fetchDevReviewSettings(slug, signal),
    staleTime: 15_000,
  });

  const patch = useMutation({
    mutationFn: (p: Parameters<typeof patchDevReviewSettings>[1]) =>
      patchDevReviewSettings(slug, p),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dev-review-settings', slug] }),
  });

  if (isLoading) return <div className="text-[12px] text-fg-3">Loading…</div>;

  const effective = {
    enabled: data?.dbOverride?.enabled ?? data?.config?.enabled ?? false,
    triggerOn: data?.dbOverride?.triggerOn ?? data?.config?.triggerOn ?? 'priority:high+',
    maxRevisionTurns: data?.dbOverride?.maxRevisionTurns ?? data?.config?.maxRevisionTurns ?? 1,
    perCycleMaxUsd: data?.dbOverride?.perCycleMaxUsd ?? data?.config?.perCycleMaxUsd ?? 2.0,
    timeoutMs: data?.dbOverride?.timeoutMs ?? data?.config?.timeoutMs ?? 180_000,
  };

  const hasDbOverride = data?.dbOverride != null;

  return (
    <div>
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-1">
        Codex dev-review advisor
      </h3>
      <p className="text-[11px] text-fg-3 mb-3">
        Runs Codex pre-QA against the PR diff once per dev cycle. If blockers are found, the
        developer gets one additional turn to address them. No second Codex pass.
        {hasDbOverride && (
          <span className="ml-1 text-accent font-medium">DB overrides active.</span>
        )}
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-[12px]">
          <label htmlFor="dr-enabled" className="w-32 text-fg-2 shrink-0">
            Enabled
          </label>
          <input
            id="dr-enabled"
            type="checkbox"
            checked={effective.enabled}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
            className="accent-accent"
          />
          {data?.config?.enabled != null && (
            <span className="text-[10px] text-fg-3">
              config: {data.config.enabled ? 'true' : 'false'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <label htmlFor="dr-trigger-on" className="w-32 text-fg-2 shrink-0">
            Trigger on
          </label>
          <select
            id="dr-trigger-on"
            value={effective.triggerOn}
            onChange={(e) => patch.mutate({ triggerOn: e.target.value })}
            disabled={!effective.enabled}
            className="rounded border border-line px-2 py-0.5 text-[12px] bg-bg text-fg disabled:opacity-40"
          >
            {TRIGGER_ON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <label htmlFor="dr-max-usd" className="w-32 text-fg-2 shrink-0">
            Max USD/cycle
          </label>
          <input
            id="dr-max-usd"
            type="number"
            step="0.5"
            min="0"
            max="50"
            value={effective.perCycleMaxUsd}
            disabled={!effective.enabled}
            onChange={(e) => patch.mutate({ perCycleMaxUsd: Number(e.target.value) })}
            className="w-20 rounded border border-line px-2 py-0.5 text-[12px] bg-bg text-fg disabled:opacity-40"
          />
          <span className="text-[10px] text-fg-3">0 = always skip</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <label htmlFor="dr-timeout" className="w-32 text-fg-2 shrink-0">
            Timeout (ms)
          </label>
          <input
            id="dr-timeout"
            type="number"
            step="30000"
            min="30000"
            max="1800000"
            value={effective.timeoutMs}
            disabled={!effective.enabled}
            onChange={(e) => patch.mutate({ timeoutMs: Number(e.target.value) })}
            className="w-28 rounded border border-line px-2 py-0.5 text-[12px] bg-bg text-fg disabled:opacity-40"
          />
        </div>
        {hasDbOverride && (
          <button
            type="button"
            onClick={() =>
              patch.mutate({
                enabled: null,
                triggerOn: null,
                maxRevisionTurns: null,
                perCycleMaxUsd: null,
                timeoutMs: null,
              })
            }
            className="text-[11px] text-fg-3 hover:text-danger border border-line/50 rounded px-2 py-0.5"
          >
            Reset to config defaults
          </button>
        )}
      </div>
    </div>
  );
}

export function ProjectModelPanel({ slug }: Props) {
  const { data, isLoading, error } = useQuery<ProjectModelSettingsDto>({
    queryKey: ['project-model-settings', slug],
    queryFn: ({ signal }) => fetchProjectModelSettings(slug, signal),
    staleTime: 10_000,
  });

  if (isLoading) return <div className="text-[12px] text-fg-3 py-4">Loading…</div>;
  if (error || !data)
    return <div className="text-[12px] text-danger py-4">Failed to load model settings.</div>;

  const roles = Object.keys(data.roles);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg-2 mb-1">
          Role model assignments
        </h3>
        <p className="text-[11px] text-fg-3 mb-4">
          DB overrides win over project config <code>rolesModels</code> and skill defaults. Clear a
          field to revert to config. Expand a row to set complexity-based rules.
        </p>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-fg-3 text-left border-b border-line">
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium px-2">Primary</th>
              <th className="pb-2 font-medium px-2">Fallback</th>
              <th className="pb-2 font-medium px-2">Advisor</th>
              <th className="pb-2 w-6" />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <RoleRow
                key={role}
                role={role}
                slug={slug}
                data={data.roles[role]}
                allowHoldoutOverride={data.allowHoldoutOverride}
              />
            ))}
          </tbody>
        </table>
      </div>

      <CodexAuthSection slug={slug} />

      <DevReviewSection slug={slug} />
    </div>
  );
}
