import type { AgentEvent } from '../event-stream/store.js';

export const GROUNDED_OUTPUT_SKILLS = new Set([
  'spec-author',
  'feature-enhance',
  'implement',
  'implement-wp',
]);

const FACTORY_TOOL_NAMES = new Set([
  'read_file',
  'read_many_files',
  'list_dir',
  'list_files',
  'file_exists',
  'file_info',
  'search_text',
  'write_file',
  'edit_file',
  'apply_patch',
  'create_directory',
  'move_file',
  'delete_file',
  'write_playwright_spec',
  'run_tests',
  'run_lint',
  'run_typecheck',
  'run_isolated_test',
  'run_playwright_spec',
  'run_package_script',
  'get_status',
  'get_diff',
  'get_changed_files',
  'get_head_sha',
  'get_merge_base',
  'get_project_context',
  'get_stack_commands',
  'repo_intel.query',
]);

const RESOURCE_PROBE_NAMES = new Set([
  'resources/list',
  'resources.templates/list',
  'resources/templates/list',
  'resources/read',
]);

export type GroundedOutputToolAnalysis = {
  toolCallCount: number;
  factoryToolCallCount: number;
  successfulFactoryToolCallCount: number;
  repoIntelCallCount: number;
  successfulRepoIntelCallCount: number;
  blockedToolCallCount: number;
  blockedToolNames: string[];
  advisoryResourceProbeFailureCount: number;
  advisoryResourceProbeNames: string[];
};

export type GroundedOutputGuardFailure = {
  reason: 'factory-tools-not-used';
  message: string;
  analysis: GroundedOutputToolAnalysis;
};

function payloadRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizedFactoryToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let name = value;
  if (name.startsWith('mcp__factory-tools__')) {
    name = name.slice('mcp__factory-tools__'.length);
  }
  if (name === 'repo_intel_query') return 'repo_intel.query';
  return name;
}

function isSuccessfulToolPayload(payload: Record<string, unknown>): boolean {
  if (payload.blocked === true) return false;
  const status = payload.status;
  if (typeof status !== 'string') return true;
  return !/^(?:failed|error|blocked|denied)$/i.test(status);
}

export function analyzeGroundedOutputToolEvents(
  events: readonly AgentEvent[],
): GroundedOutputToolAnalysis {
  let toolCallCount = 0;
  let factoryToolCallCount = 0;
  let successfulFactoryToolCallCount = 0;
  let repoIntelCallCount = 0;
  let successfulRepoIntelCallCount = 0;
  let blockedToolCallCount = 0;
  let advisoryResourceProbeFailureCount = 0;
  const blockedToolNames = new Set<string>();
  const advisoryResourceProbeNames = new Set<string>();

  for (const event of events) {
    if (event.kind !== 'agent.tool-call') continue;
    toolCallCount++;
    const payload = payloadRecord(event.payload);
    if (payload == null) continue;
    const toolName = normalizedFactoryToolName(
      payload.tool_name ?? payload.toolName ?? payload.tool,
    );
    const successful = isSuccessfulToolPayload(payload);
    if (!successful) {
      blockedToolCallCount++;
      if (toolName != null) blockedToolNames.add(toolName);
    }
    if (toolName == null) continue;
    if (RESOURCE_PROBE_NAMES.has(toolName)) {
      if (!successful) {
        advisoryResourceProbeFailureCount++;
        advisoryResourceProbeNames.add(toolName);
      }
      continue;
    }
    if (!FACTORY_TOOL_NAMES.has(toolName)) continue;
    factoryToolCallCount++;
    if (toolName === 'repo_intel.query') repoIntelCallCount++;
    if (successful) {
      successfulFactoryToolCallCount++;
      if (toolName === 'repo_intel.query') successfulRepoIntelCallCount++;
    }
  }

  return {
    toolCallCount,
    factoryToolCallCount,
    successfulFactoryToolCallCount,
    repoIntelCallCount,
    successfulRepoIntelCallCount,
    blockedToolCallCount,
    blockedToolNames: Array.from(blockedToolNames),
    advisoryResourceProbeFailureCount,
    advisoryResourceProbeNames: Array.from(advisoryResourceProbeNames),
  };
}

export function groundedOutputToolUseFailure(input: {
  skill: string;
  events: readonly AgentEvent[];
  noToolSafe?: boolean;
  allowMissingAudit?: boolean;
}): GroundedOutputGuardFailure | null {
  if (input.noToolSafe === true) return null;
  if (!GROUNDED_OUTPUT_SKILLS.has(input.skill)) return null;
  const analysis = analyzeGroundedOutputToolEvents(input.events);
  const hasRuntimeLifecycle = input.events.some(
    (event) =>
      event.kind === 'agent.run-started' ||
      event.kind === 'agent.run-completed' ||
      event.kind === 'agent.run-failed',
  );
  const hasFactoryAudit = analysis.factoryToolCallCount > 0;
  if (input.allowMissingAudit === true && !hasRuntimeLifecycle && !hasFactoryAudit) return null;
  if (analysis.successfulFactoryToolCallCount > 0) return null;
  return {
    reason: 'factory-tools-not-used',
    message: `${input.skill} produced repo-grounded output after zero successful Factory tool calls`,
    analysis,
  };
}
