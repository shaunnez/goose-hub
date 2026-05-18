import type { ProjectConfig, Role } from '../types.js';
import type { ResolvedBudget } from './budgets.js';
import type { AgentRuntime } from './interface.js';
import type { ModelProvider } from './models.js';
import { type ConfigRuntime, selectRuntime } from './select-runtime.js';
import {
  forcedProviderFromRuntime,
  resolveSkillRuntimeForProject,
} from './skill-runtime-resolver.js';

export interface ProjectAgentExecution {
  runtime: AgentRuntime;
  resolvedBudget: ResolvedBudget;
}

export function resolveProjectAgentExecution(input: {
  skill: string;
  role: Role;
  projectId: string;
  projectConfig: Partial<ProjectConfig> | null | undefined;
  injectedRuntime?: AgentRuntime;
  skillProvider?: ModelProvider;
}): ProjectAgentExecution {
  const configRuntime = input.projectConfig?.agentConfig?.runtime ?? 'auto';
  const resolvedBudget = resolveSkillRuntimeForProject({
    skill: input.skill,
    projectBudgets: input.projectConfig?.budgets,
    projectId: input.projectId,
    configRuntime,
    skillProvider: input.skillProvider,
    role: input.role,
    allowHoldoutOverride: input.projectConfig?.agentConfig?.allowHoldoutOverride,
    ignoreProviderOverride: input.injectedRuntime != null,
  });

  if (input.injectedRuntime != null) {
    return { runtime: input.injectedRuntime, resolvedBudget };
  }

  return {
    runtime: selectRuntime({
      configRuntime,
      model: resolvedBudget.modelOverride,
      skillProvider: forcedProviderFromRuntime(configRuntime) ?? resolvedBudget.provider,
    }),
    resolvedBudget,
  };
}
