import { createHash } from 'node:crypto';
import {
  type FeatureEnhanceOutput,
  FeatureEnhanceOutputSchema,
} from '@goose-hub/skills/feature-enhance/schema.js';
import featureEnhanceConfig, {
  FeatureEnhanceContextSchema,
} from '@goose-hub/skills/feature-enhance/skill.config.js';
import type { z } from 'zod';
import type { AgentEvent } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { logger } from '../logger.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { ProjectConfig } from '../types.js';
import type { AgentRuntime } from './interface.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { readPromptWithContext } from './read-prompt.js';
import { toJsonSchema } from './schema-bridge.js';
import { selectPersona } from './select-persona.js';
import { selectRuntime } from './select-runtime.js';
import { resolveSkillRuntimeForProject } from './skill-runtime-resolver.js';

const FEATURE_ENHANCE_SKILL = 'feature-enhance';

type FeatureEnhanceContext = z.infer<typeof FeatureEnhanceContextSchema>;

export type FeatureEnhanceEmptyReason =
  | 'no-tool-call-made'
  | 'tool-call-blocked'
  | 'output-validation-failed'
  | 'runtime-failed'
  | 'runtime-max-turn-failed'
  | 'no-grounded-output'
  | 'candidate-files-without-tool-verified-evidence';

export type FeatureEnhanceEmptyPayload = {
  parentRunId?: string;
  enhanceRunId: string;
  reason: FeatureEnhanceEmptyReason;
  reasons: FeatureEnhanceEmptyReason[];
  validationIssues?: Array<{ path: string; message: string }>;
  outputPreview?: string;
  blockedToolNames: string[];
  toolCallCount: number;
  repoIntelCallCount: number;
  blockedToolCallCount: number;
  runtime?: string;
  modelId?: string;
  outputSchemaHash?: string;
  error?: string;
};

export type FeatureEnhanceRunResult =
  | { ok: true; output: FeatureEnhanceOutput; enhanceRunId: string; personaId: string }
  | {
      ok: false;
      enhanceRunId: string;
      reason: string;
      telemetry: FeatureEnhanceEmptyPayload;
    };

export type RunFeatureEnhanceInput = {
  projectId: string;
  workItemId: string;
  enhanceRunId: string;
  parentRunId?: string;
  context: FeatureEnhanceContext;
  workspaceDir?: string;
  runtimeOverride?: AgentRuntime;
  projectConfigOverride?: Partial<ProjectConfig> | null;
  extraEventPayload?: Record<string, unknown>;
};

type ToolEventAnalysis = {
  toolCallCount: number;
  repoIntelCallCount: number;
  blockedToolCallCount: number;
  blockedToolNames: string[];
};

type RuntimeDiagnostics = {
  runtime?: string;
  modelId?: string;
  outputSchemaHash?: string;
};

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function schemaHash(schema: Record<string, unknown> | undefined): string | undefined {
  if (schema == null) return undefined;
  return createHash('sha256').update(stableJson(schema)).digest('hex').slice(0, 16);
}

function outputPreview(output: unknown): string {
  const serialized = typeof output === 'string' ? output : JSON.stringify(output);
  return serialized.slice(0, 2_000);
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizedToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('mcp__factory-tools__')) {
    return value.slice('mcp__factory-tools__'.length);
  }
  return value;
}

function analyzeToolEvents(events: readonly AgentEvent[]): ToolEventAnalysis {
  let toolCallCount = 0;
  let repoIntelCallCount = 0;
  let blockedToolCallCount = 0;
  const blockedToolNames = new Set<string>();

  for (const event of events) {
    if (event.kind !== 'agent.tool-call') continue;
    toolCallCount++;
    const payload = payloadRecord(event.payload);
    const toolName = normalizedToolName(payload?.tool_name ?? payload?.toolName ?? payload?.tool);
    if (toolName === 'repo_intel.query') repoIntelCallCount++;
    if (payload?.blocked === true || payload?.status === 'failed') {
      blockedToolCallCount++;
      if (toolName != null) blockedToolNames.add(toolName);
    }
  }

  return {
    toolCallCount,
    repoIntelCallCount,
    blockedToolCallCount,
    blockedToolNames: Array.from(blockedToolNames),
  };
}

function isGrounded(output: FeatureEnhanceOutput): boolean {
  return (
    output.candidateFiles.length > 0 ||
    output.existingSurfaces.length > 0 ||
    output.testSurfaces.length > 0 ||
    output.similarPatterns.length > 0 ||
    output.acceptanceHints.length > 0
  );
}

function buildEmptyReasons(input: {
  output: FeatureEnhanceOutput;
  toolAnalysis: ToolEventAnalysis;
}): FeatureEnhanceEmptyReason[] {
  const reasons = new Set<FeatureEnhanceEmptyReason>();
  if (input.toolAnalysis.toolCallCount === 0) reasons.add('no-tool-call-made');
  if (input.toolAnalysis.blockedToolCallCount > 0) reasons.add('tool-call-blocked');
  if (!isGrounded(input.output)) reasons.add('no-grounded-output');
  if (
    input.output.candidateFiles.length > 0 &&
    !input.output.candidateFiles.some((candidate) => candidate.source === 'tool-verified')
  ) {
    reasons.add('candidate-files-without-tool-verified-evidence');
  }
  return Array.from(reasons);
}

function appendEmptyEvent(input: {
  runInput: RunFeatureEnhanceInput;
  reasons: FeatureEnhanceEmptyReason[];
  analysis: ToolEventAnalysis;
  diagnostics: RuntimeDiagnostics;
  personaId?: string;
  details?: Partial<
    Pick<FeatureEnhanceEmptyPayload, 'validationIssues' | 'outputPreview' | 'error'>
  >;
}): FeatureEnhanceEmptyPayload {
  const [reason = 'no-grounded-output'] = input.reasons;
  const payload: FeatureEnhanceEmptyPayload = {
    ...(input.runInput.parentRunId != null ? { parentRunId: input.runInput.parentRunId } : {}),
    enhanceRunId: input.runInput.enhanceRunId,
    reason,
    reasons: input.reasons.length > 0 ? input.reasons : [reason],
    blockedToolNames: input.analysis.blockedToolNames,
    toolCallCount: input.analysis.toolCallCount,
    repoIntelCallCount: input.analysis.repoIntelCallCount,
    blockedToolCallCount: input.analysis.blockedToolCallCount,
    ...(input.diagnostics.runtime != null ? { runtime: input.diagnostics.runtime } : {}),
    ...(input.diagnostics.modelId != null ? { modelId: input.diagnostics.modelId } : {}),
    ...(input.diagnostics.outputSchemaHash != null
      ? { outputSchemaHash: input.diagnostics.outputSchemaHash }
      : {}),
    ...input.details,
  };

  eventStore.appendEvent({
    projectId: input.runInput.projectId,
    workItemId: input.runInput.workItemId,
    kind: 'agent.feature-enhance-empty',
    payload,
    runId: input.runInput.enhanceRunId,
    personaId: input.personaId,
  });

  return payload;
}

function runtimeName(provider: string): string {
  return provider === 'codex' ? 'codex-cli' : 'claude-cli';
}

function runtimeFailureReason(error: unknown): FeatureEnhanceEmptyReason {
  const message = String(error);
  return /\b(max[- ]?turn|tool-call budget exceeded|budget exceeded)\b/i.test(message)
    ? 'runtime-max-turn-failed'
    : 'runtime-failed';
}

export async function runFeatureEnhance(
  input: RunFeatureEnhanceInput,
): Promise<FeatureEnhanceRunResult> {
  const projectConfig =
    input.projectConfigOverride !== undefined
      ? input.projectConfigOverride
      : await getProjectBySlug(input.projectId);
  const resolved = resolveSkillRuntimeForProject({
    skill: FEATURE_ENHANCE_SKILL,
    projectBudgets: projectConfig?.budgets,
    projectId: input.projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    skillProvider: featureEnhanceConfig.provider,
    fallbackTier: featureEnhanceConfig.modelPin,
    fallbackProvider: featureEnhanceConfig.provider,
    role: featureEnhanceConfig.role ?? 'developer',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
    ignoreProviderOverride: input.runtimeOverride != null,
  });
  const runtime =
    input.runtimeOverride ??
    selectRuntime({
      configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
      model: resolved.modelOverride,
      skillProvider: featureEnhanceConfig.provider,
    });
  const outputJsonSchema = toJsonSchema(FeatureEnhanceOutputSchema) as Record<string, unknown>;
  const diagnostics: RuntimeDiagnostics = {
    runtime: runtimeName(resolved.provider),
    modelId: resolved.modelOverride,
    outputSchemaHash: schemaHash(outputJsonSchema),
  };
  const role = featureEnhanceConfig.role ?? 'developer';
  const { personaId } = selectPersona(input.projectId, role);
  const appendSystemPrompt = readPromptWithContext(FEATURE_ENHANCE_SKILL, input.projectId);

  const contextResult = FeatureEnhanceContextSchema.safeParse(input.context);
  if (!contextResult.success) {
    const telemetry = appendEmptyEvent({
      runInput: input,
      reasons: ['output-validation-failed'],
      analysis: {
        toolCallCount: 0,
        repoIntelCallCount: 0,
        blockedToolCallCount: 0,
        blockedToolNames: [],
      },
      diagnostics,
      personaId,
      details: {
        validationIssues: contextResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return {
      ok: false,
      enhanceRunId: input.enhanceRunId,
      reason: telemetry.reason,
      telemetry,
    };
  }

  try {
    const result = await runtime.run({
      runId: input.enhanceRunId,
      role,
      skill: FEATURE_ENHANCE_SKILL,
      ...(input.workspaceDir != null ? { workspaceDir: input.workspaceDir } : {}),
      context: {
        ...contextResult.data,
        projectId: input.projectId,
        workItemId: input.workItemId,
      },
      contextAllowlist: featureEnhanceConfig.contextAllowlist,
      freshContext: featureEnhanceConfig.freshContext,
      toolBundles: ['read'],
      toolExtras: [],
      budgets: resolved.budgets,
      effort: resolved.effort,
      personaId,
      workItemId: input.workItemId,
      modelOverride: resolved.modelOverride,
      outputJsonSchema,
      appendSystemPrompt,
      extraEventPayload: {
        ...input.extraEventPayload,
        ...(input.parentRunId != null ? { parentRunId: input.parentRunId } : {}),
      },
    });

    const analysis = analyzeToolEvents(result.events);
    const parsed = safeParseOutputForSchema(FeatureEnhanceOutputSchema, result.output);
    if (!parsed.success) {
      logger.warn('feature-enhance: output validation failed', {
        runId: input.enhanceRunId,
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
      });
      const telemetry = appendEmptyEvent({
        runInput: input,
        reasons: ['output-validation-failed'],
        analysis,
        diagnostics,
        personaId,
        details: {
          validationIssues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          outputPreview: outputPreview(result.output),
        },
      });
      return {
        ok: false,
        enhanceRunId: input.enhanceRunId,
        reason: telemetry.reason,
        telemetry,
      };
    }

    const emptyReasons = buildEmptyReasons({ output: parsed.data, toolAnalysis: analysis });
    if (emptyReasons.length > 0) {
      const telemetry = appendEmptyEvent({
        runInput: input,
        reasons: emptyReasons,
        analysis,
        diagnostics,
        personaId,
        details: { outputPreview: outputPreview(parsed.data) },
      });
      return {
        ok: false,
        enhanceRunId: input.enhanceRunId,
        reason: telemetry.reason,
        telemetry,
      };
    }

    return { ok: true, output: parsed.data, enhanceRunId: input.enhanceRunId, personaId };
  } catch (err) {
    logger.error('feature-enhance: agent run failed', {
      runId: input.enhanceRunId,
      err: String(err),
    });
    const analysis = analyzeToolEvents(eventStore.replay({ runId: input.enhanceRunId }));
    const telemetry = appendEmptyEvent({
      runInput: input,
      reasons: [runtimeFailureReason(err)],
      analysis,
      diagnostics,
      personaId,
      details: { error: String(err) },
    });
    return {
      ok: false,
      enhanceRunId: input.enhanceRunId,
      reason: telemetry.reason,
      telemetry,
    };
  }
}
