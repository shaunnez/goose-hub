import type { ProjectConfig, Role } from '../types.js';
import type { ResolvedBudget } from './budgets.js';
import type { AgentRuntime } from './interface.js';
import { type ModelProvider, defaultModelForTierAndProvider, tierOf } from './models.js';
import { resolveBudgetsForProject, resolveRoleModelForProject } from './resolve-for-project.js';
import { type ConfigRuntime, selectRuntime } from './select-runtime.js';

export interface ProjectAgentExecution {
  runtime: AgentRuntime;
  resolvedBudget: ResolvedBudget;
}

function forcedProviderFromRuntime(configRuntime: ConfigRuntime): ModelProvider | null {
  if (configRuntime === 'codex-cli') return 'codex';
  if (configRuntime === 'claude-cli') return 'claude';
  return null;
}

export function resolveProjectAgentExecution(input: {
  skill: string;
  role: Role;
  projectId: string;
  projectConfig: Partial<ProjectConfig> | null | undefined;
  injectedRuntime?: AgentRuntime;
  skillProvider?: ModelProvider;
}): ProjectAgentExecution {
  const resolvedBudget = resolveBudgetsForProject(
    input.skill,
    input.projectConfig?.budgets,
    input.projectId,
  );

  if (input.injectedRuntime != null) {
    return { runtime: input.injectedRuntime, resolvedBudget };
  }

  const roleModel = resolveRoleModelForProject({
    role: input.role,
    projectId: input.projectId,
    configRoleModel: input.projectConfig?.agentConfig?.rolesModels?.[input.role],
    allowHoldoutOverride: input.projectConfig?.agentConfig?.allowHoldoutOverride,
    skill: input.skill,
    skillProvider: input.skillProvider,
  });
  const configRuntime = input.projectConfig?.agentConfig?.runtime ?? 'auto';
  const provider =
    forcedProviderFromRuntime(configRuntime) ??
    (roleModel.source === 'db' || roleModel.source === 'config'
      ? roleModel.provider
      : (input.skillProvider ?? 'claude'));
  const tier =
    roleModel.source === 'db' || roleModel.source === 'config'
      ? roleModel.tier
      : tierOf(resolvedBudget.modelOverride);
  const modelOverride = defaultModelForTierAndProvider(tier, provider);
  return {
    runtime: selectRuntime({ configRuntime, model: modelOverride, skillProvider: provider }),
    resolvedBudget: { ...resolvedBudget, modelOverride },
  };
}
