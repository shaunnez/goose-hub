import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { recordCost, recordToolStatsForRun } from '../cost/repository.js';
import { stageForSkill } from '../cost/skill-stage.js';
import { getRecordDecisionTool } from '../db/repositories/project-settings.js';
import { eventStore } from '../event-stream/store.js';
import { deployDecisionCaptureHook } from '../tool-layer/decision-capture-hook.js';
import { buildFactoryMcpConfig } from '../tool-layer/mcp/build-config.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeCodexWorkspaceSandbox, writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { bindToolsForAgentSpec } from '../tool-layer/tool-binding.js';
import { normalizeToolCallAuditPayload } from '../tool-layer/tool-call-audit.js';
import { emitBudgetExceededIfNeeded } from './budget-guard.js';
import {
  CodexBinaryNotFoundError,
  CodexNotAuthenticatedError,
  assertCodexAuthenticated,
  buildCodexArgv,
  buildCodexMcpInlineArgs,
  escapeForTomlMultilineBasic,
  resolveCodexBinary,
} from './codex-config.js';
import {
  extractResultJson,
  parseCodexEnvelope,
  pickCodexAgentMessageText,
  pickCodexAssistantMessage,
  pickCodexToolCall,
} from './codex-parser.js';
import { assembleSpawnContext } from './context-assembly.js';
import { parseDecisionMarkersAfter } from './decision-markers.js';
import { isDecisionKind } from './decision-types.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';
import { defaultModelForTierAndProvider, estimateCostUsd } from './models.js';
import { killProcessGroupOrChild } from './process-kill.js';
import { recordAgentRun } from './run-record.js';
import { withFactoryRuntimeInstructions } from './runtime-instructions.js';

export { CodexBinaryNotFoundError, CodexNotAuthenticatedError } from './codex-config.js';
export {
  resolveCodexBinary,
  assertCodexAuthenticated,
  buildCodexArgv,
  escapeForTomlMultilineBasic,
} from './codex-config.js';
export {
  parseCodexEnvelope,
  extractResultJson,
  pickCodexAssistantMessage,
  pickCodexAgentMessageText,
  pickCodexToolCall,
} from './codex-parser.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const OUTPUT_SCHEMAS_DIR = '.factory/output-schemas';
const ABSOLUTE_USER_PATH_RE = /\/Users\/[^\s'"`]+/g;
const NATIVE_PATCH_REJECTION_RE =
  /patch rejected:\s*writing is blocked by read-only sandbox|writing is blocked by read-only sandbox/i;
const FORBIDDEN_RUNTIME_SURFACE_PATTERNS: Array<{
  surface: string;
  toolName: string;
  re: RegExp;
}> = [
  { surface: 'collab spawn failed', toolName: 'collab.spawn', re: /collab\s+spawn\s+failed/i },
  {
    surface: 'full-history fork/spawn failed',
    toolName: 'full-history-fork-spawn',
    re: /(?:full[- ]history.*(?:fork|spawn)|(?:fork|spawn).*full[- ]history).*(?:failed|error)/i,
  },
];
const ADVISORY_RUNTIME_SURFACE_PATTERNS: Array<{
  surface: string;
  toolName: string;
  re: RegExp;
}> = [
  {
    surface: 'resources/templates/list failed',
    toolName: 'resources/templates/list',
    re: /resources\/templates\/list(?:\s+failed|[^\n]*transient stderr)/i,
  },
  {
    surface: 'resources/list failed',
    toolName: 'resources/list',
    re: /resources\/list(?:\s+failed|[^\n]*transient stderr)/i,
  },
  {
    surface: 'resources/read failed',
    toolName: 'resources/read',
    re: /resources\/read(?:\?path=[^\s]+)?(?:\s+failed|[^\n]*transient stderr)/i,
  },
  {
    surface: 'resources/list failed',
    toolName: 'resources/list',
    re: /resources\/list(?:\?path=[^\s]+)?(?:\s+failed|[^\n]*transient stderr)/i,
  },
];

function isPathUnderRoot(path: string, root: string): boolean {
  const normalizedRoot = join(root, '.');
  const normalizedPath = join(path, '.');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function workspaceBoundaryViolation(input: {
  toolCall: { toolName: string; toolInput: Record<string, unknown> };
  workspaceDir: string;
  allowedSecondaryWorkspaces?: string;
}): string | null {
  if (input.toolCall.toolName !== 'Bash') return null;
  const command = input.toolCall.toolInput.command;
  if (typeof command !== 'string') return null;

  const allowedRoots = [
    input.workspaceDir,
    ...(input.allowedSecondaryWorkspaces ?? '')
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean),
  ];
  for (const absolutePath of command.match(ABSOLUTE_USER_PATH_RE) ?? []) {
    if (!allowedRoots.some((root) => isPathUnderRoot(absolutePath, root))) {
      return `Bash command references path outside workspace: ${absolutePath}`;
    }
  }
  return null;
}

function toolAllowedByRunAllowlist(toolName: string, allowedTools: ReadonlyArray<string>): boolean {
  if (allowedTools.length === 0) return false;
  return allowedTools.some((entry) => {
    if (entry === toolName) return true;
    return entry.split('(')[0] === toolName;
  });
}

function contextSizeTelemetry(input: { contextXml: string; systemPrompt: string }): {
  contextChars: number;
  systemPromptChars: number;
  totalPromptChars: number;
  estimatedPromptTokens: number;
} {
  const contextChars = input.contextXml.length;
  const systemPromptChars = input.systemPrompt.length;
  const totalPromptChars = contextChars + systemPromptChars;
  return {
    contextChars,
    systemPromptChars,
    totalPromptChars,
    estimatedPromptTokens: Math.ceil(totalPromptChars / 4),
  };
}

function stderrIncludesNativePatchRejection(stderr: string): boolean {
  return NATIVE_PATCH_REJECTION_RE.test(stderr);
}

function detectForbiddenRuntimeSurface(stderr: string): {
  surface: string;
  toolName: string;
  blockReason: string;
} | null {
  for (const pattern of FORBIDDEN_RUNTIME_SURFACE_PATTERNS) {
    if (pattern.re.test(stderr)) {
      return {
        surface: pattern.surface,
        toolName: pattern.toolName,
        blockReason: `forbidden-runtime-surface: ${pattern.surface}`,
      };
    }
  }
  return null;
}

function handleForbiddenRuntimeSurface(line: string): {
  surface: string;
  toolName: string;
  blockReason: string;
} | null {
  return detectForbiddenRuntimeSurface(line);
}

function parseRequestedPath(line: string): string | undefined {
  const match = line.match(/resources\/(?:read|list)\?path=([^\s&]+)/i);
  if (match == null) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function detectRuntimeAdvisorySurface(line: string): {
  surface: string;
  toolName: string;
  requestedPath?: string;
} | null {
  for (const pattern of ADVISORY_RUNTIME_SURFACE_PATTERNS) {
    if (pattern.re.test(line)) {
      return {
        surface: pattern.surface,
        toolName: pattern.toolName,
        requestedPath: parseRequestedPath(line),
      };
    }
  }
  return null;
}

export function appendRuntimeAdvisoryEvent(input: {
  line: string;
  projectId: string;
  workItemId: string | null;
  runId: string;
  personaId?: string;
  skill: string;
}): boolean {
  const advisory = detectRuntimeAdvisorySurface(input.line);
  if (advisory == null) return false;
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.runtime-advisory',
    payload: {
      runId: input.runId,
      skill: input.skill,
      surface: advisory.surface,
      stderr: input.line.slice(0, 4000),
      toolName: advisory.toolName,
      requestedPath: advisory.requestedPath,
    },
    runId: input.runId,
    personaId: input.personaId,
  });
  return true;
}

function filterRuntimeAdvisoryStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter((line) => detectRuntimeAdvisorySurface(line) == null)
    .join('\n');
}

function outputSchemaPathForRun(workspaceDir: string, runId: string): string {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 16);
  return join(workspaceDir, OUTPUT_SCHEMAS_DIR, `${digest}.schema.json`);
}

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

function codexRunAllowlist(input: {
  allowlist: ReadonlyArray<string>;
  enabledToolsByServer: Record<string, string[]>;
}): string {
  const values = new Set(input.allowlist);
  for (const tools of Object.values(input.enabledToolsByServer)) {
    for (const tool of tools) {
      values.add(tool);
    }
  }
  return Array.from(values).sort().join(',');
}

function outputSchemaHash(schema: Record<string, unknown> | undefined): string | undefined {
  if (schema == null || Object.keys(schema).length === 0) return undefined;
  return createHash('sha256').update(stableJson(schema)).digest('hex').slice(0, 16);
}

export class CodexCliRuntime implements AgentRuntime {
  async run(spec: AgentSpec): Promise<AgentResult> {
    if (process.env.MOCK_AGENTS === 'true') {
      return resolveMockOutput(spec);
    }

    const { runId } = spec;
    const workspaceDir = spec.workspaceDir ?? join(WORKSPACES_DIR, runId);

    // Pre-flight: binary + auth must both be present before we mkdir or emit events.
    const binaryPath = resolveCodexBinary();
    assertCodexAuthenticated();

    mkdirSync(workspaceDir, { recursive: true });
    const projectId = (spec.context.projectId as string) ?? 'unknown';
    const workItemId = (spec.context.workItemId as string | undefined) ?? spec.workItemId ?? null;
    const { personaId } = spec;
    const recordRun = (outcome: 'success' | 'failure') => {
      recordAgentRun({
        runId,
        personaId,
        workItemId: spec.workItemId ?? workItemId ?? null,
        projectId,
        role: spec.role,
        skill: spec.skill,
        outcome,
      });
    };
    const toolBinding = bindToolsForAgentSpec(spec);
    const allowedTools = toolBinding.allowlist;
    // Per-run MCP config (ADR 0045). For Claude we pass `--mcp-config`; for
    // Codex we pass each MCP server entry as `-c mcp_servers.<n>.command=...`
    // / `.args=...` / `.env=...` since Codex CLI consumes MCP via TOML and
    // `--ignore-user-config` skips `~/.codex/config.toml`. The JSON config
    // file is still written under the worktree for parity / debugging.
    const { config: factoryMcpConfig } = buildFactoryMcpConfig({
      workspaceDir,
      runId,
      projectId,
      workItemId,
      skill: spec.skill,
      personaId,
      toolBundles: toolBinding.mcpServerBundles,
    });
    const codexMcpInlineArgs = buildCodexMcpInlineArgs(
      Object.fromEntries(
        Object.entries(factoryMcpConfig.mcpServers).map(([name, entry]) => [
          name,
          {
            ...entry,
            // enabled_tools is intentionally omitted: Codex CLI 0.137.0 ignores the
            // allowlist when this field is set (even non-empty), making all MCP tools
            // invisible. Enforcement is via PreToolUse hook + FACTORY_RUN_ALLOWLIST.
            ...(name === 'factory-tools'
              ? {
                  required: true,
                  startupTimeoutSec: 20,
                  toolTimeoutSec: 600,
                  env: { ...entry.env, FACTORY_FORBID_MCP_RESOURCES: '1' },
                }
              : {}),
          },
        ]),
      ),
    );
    const recordDecisionTool = getRecordDecisionTool(projectId);
    if (spec.sandboxMode !== 'preconfigured') {
      writeWorkspaceSandbox(workspaceDir, { role: spec.role, recordDecisionTool });
    }
    writeCodexWorkspaceSandbox(workspaceDir);
    deployHooks();
    if (recordDecisionTool) deployDecisionCaptureHook();
    const model = spec.modelOverride ?? defaultModelForTierAndProvider('sonnet', 'codex');
    const outputSchemaPath =
      spec.outputJsonSchema != null && Object.keys(spec.outputJsonSchema).length > 0
        ? outputSchemaPathForRun(workspaceDir, runId)
        : undefined;
    if (outputSchemaPath != null) {
      mkdirSync(dirname(outputSchemaPath), { recursive: true });
      writeFileSync(outputSchemaPath, `${JSON.stringify(spec.outputJsonSchema, null, 2)}\n`, {
        flag: 'w',
      });
    }
    const schemaHash = outputSchemaHash(spec.outputJsonSchema);

    if (spec.suppressRunStarted !== true) {
      eventStore.appendEvent({
        projectId,
        workItemId,
        kind: 'agent.run-started',
        payload: {
          skill: spec.skill,
          runId,
          personaId,
          modelId: model,
          runtime: 'codex-cli',
          toolBundles: spec.toolBundles,
          toolBindingHash: toolBinding.fingerprints.toolBindingHash,
          toolAllowlistHash: toolBinding.fingerprints.toolAllowlistHash,
          mcpServerSetHash: toolBinding.fingerprints.mcpServerSetHash,
          nativeToolCount: toolBinding.nativeTools.length,
          mcpServerNames: toolBinding.mcpServerNames,
          toolBindingWarningCount: toolBinding.warnings.length,
          toolBindingWarnings: toolBinding.warnings,
          ...(outputSchemaPath != null ? { outputSchemaPath } : {}),
          ...(schemaHash != null ? { outputSchemaHash: schemaHash } : {}),
          ...spec.extraEventPayload,
        },
        runId,
        personaId,
      });
    }
    if (toolBinding.warnings.length > 0) {
      eventStore.appendEvent({
        projectId,
        workItemId,
        kind: 'agent.log',
        payload: {
          runId,
          skill: spec.skill,
          stream: 'telemetry',
          metric: 'tool_binding_warnings',
          warningCount: toolBinding.warnings.length,
          warnings: toolBinding.warnings,
        },
        runId,
        personaId,
      });
    }

    const { contextXml } = assembleSpawnContext(spec);
    const systemPrompt = withFactoryRuntimeInstructions(spec.appendSystemPrompt, {
      runtime: 'codex-cli',
    });
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'agent.log',
      payload: {
        runId,
        skill: spec.skill,
        stream: 'telemetry',
        metric: 'prompt_context_size',
        ...contextSizeTelemetry({ contextXml, systemPrompt }),
      },
      runId,
      personaId,
    });
    const commandSandbox =
      toolBinding.sandboxMode === 'read-only' ? undefined : toolBinding.sandboxMode;

    const argv = buildCodexArgv({
      model,
      workspaceDir,
      prompt: contextXml,
      systemPrompt,
      effort: spec.effort,
      maxTurns: spec.budgets.maxTurns,
      commandSandbox,
      approvalPolicy: toolBinding.approvalPolicy,
      bypassHookTrust: true,
      disableShellTool: !toolBinding.nativeTools.includes('Bash'),
      restrictToFactoryTools: true,
      outputSchemaPath,
      inlineConfig: codexMcpInlineArgs,
    });

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const minimalEnv: Record<string, string> = {
        HOME: homedir(),
        ...(isWindows
          ? {
              USERNAME: process.env.USERNAME ?? '',
              USERPROFILE: homedir(),
              TEMP: process.env.TEMP ?? homedir(),
              TMP: process.env.TMP ?? homedir(),
              PATH: `${dirname(binaryPath)};C:\\Windows\\System32;C:\\Windows`,
              APPDATA: process.env.APPDATA ?? '',
              LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
            }
          : {
              USER: process.env.USER ?? '',
              TMPDIR: process.env.TMPDIR ?? '/tmp',
              PATH:
                process.platform === 'darwin'
                  ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
                  : '/usr/local/bin:/usr/bin:/bin',
            }),
        FACTORY_RUN_ALLOWLIST: codexRunAllowlist({
          allowlist: allowedTools,
          enabledToolsByServer: toolBinding.enabledToolsByServer,
        }),
        FACTORY_RUN_ID: runId,
        FACTORY_PROJECT_ID: projectId,
        FACTORY_WORKSPACE_DIR: workspaceDir,
        FACTORY_SERVER_PORT: process.env.FACTORY_SERVER_PORT ?? '3001',
        FACTORY_FORBID_MCP_RESOURCES: '1',
        FACTORY_ITERATION: String(spec.iteration ?? 0),
        FACTORY_PHASE: spec.phase ?? '',
      };
      // OPENAI_API_KEY passthrough for users who prefer key-based auth over OAuth.
      if (process.env.OPENAI_API_KEY != null) {
        minimalEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      }
      if (spec.env) {
        Object.assign(minimalEnv, spec.env);
      }

      const child = spawn(binaryPath, argv, {
        env: minimalEnv,
        cwd: workspaceDir,
        detached: !isWindows,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stdoutLineBuffer = '';
      let stderrLineBuffer = '';
      let truncated = false;
      let settled = false;
      let toolCallCount = 0;
      let emittedNativePatchBlocked = false;
      const emittedRuntimeAdvisorySurfaces = new Set<string>();
      const assistantMarkerOffsets = new Map<string, number>();

      const emitNativePatchBlocked = () => {
        if (emittedNativePatchBlocked) return;
        emittedNativePatchBlocked = true;
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.tool-call',
          payload: normalizeToolCallAuditPayload({
            tool_name: 'apply_patch',
            run_id: runId,
            tool_input: { source: 'codex-native' },
            skill: spec.skill,
            workspace_dir: workspaceDir,
            blocked: true,
            block_reason: 'native-write-blocked',
            status: 'failed',
          }),
          runId,
          personaId,
        });
      };

      const emitForbiddenRuntimeSurfaceBlocked = (violation: {
        surface: string;
        toolName: string;
        blockReason: string;
      }) => {
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.tool-call',
          payload: normalizeToolCallAuditPayload({
            tool_name: violation.toolName,
            run_id: runId,
            tool_input: { source: 'codex-stderr', surface: violation.surface },
            skill: spec.skill,
            workspace_dir: workspaceDir,
            blocked: true,
            block_reason: violation.blockReason,
            status: 'failed',
          }),
          runId,
          personaId,
        });
      };

      const failForbiddenRuntimeSurface = (violation: {
        surface: string;
        toolName: string;
        blockReason: string;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        emitForbiddenRuntimeSurfaceBlocked(violation);
        recordRun('failure');
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-failed',
          payload: {
            runId,
            skill: spec.skill,
            reason: 'forbidden-runtime-surface',
            error: violation.blockReason,
          },
          runId,
          personaId,
        });
        killProcessGroupOrChild(child);
        reject(new Error(violation.blockReason));
      };

      const handleStdoutLine = (line: string) => {
        if (line.trim().length === 0) return;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (parsed == null || typeof parsed !== 'object') return;
          const event = parsed as Record<string, unknown>;
          const assistantMessage = pickCodexAssistantMessage(event);
          if (assistantMessage != null) {
            const key = assistantMessage.id ?? '__default_assistant_message__';
            const previousOffset = assistantMarkerOffsets.get(key) ?? 0;
            const scanText = assistantMessage.terminal
              ? assistantMessage.text
              : completeLinePrefix(assistantMessage.text);
            const safePreviousOffset =
              scanText.length < previousOffset || assistantMessage.text.length < previousOffset
                ? 0
                : previousOffset;
            const markers = parseDecisionMarkersAfter(scanText, safePreviousOffset);
            assistantMarkerOffsets.set(key, Math.max(safePreviousOffset, scanText.length));
            for (const marker of markers) {
              const kind = isDecisionKind(marker.kind) ? marker.kind : 'UNKNOWN';
              eventStore.appendEvent({
                projectId,
                workItemId,
                kind: 'agent.decision-summary-live',
                payload: {
                  run_id: runId,
                  kind,
                  summary: marker.summary,
                  timestamp: new Date().toISOString(),
                  skill: spec.skill,
                  personaId,
                },
                runId,
                personaId,
              });
            }
          }

          const toolCall = pickCodexToolCall(event);
          if (toolCall == null) return;
          toolCallCount += 1;
          const allowlistReason = toolAllowedByRunAllowlist(toolCall.toolName, allowedTools)
            ? null
            : `tool not in allowlist: ${toolCall.toolName}`;
          if (allowlistReason != null && !settled) {
            settled = true;
            clearTimeout(timeout);
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.tool-call',
              payload: normalizeToolCallAuditPayload({
                tool_name: toolCall.toolName,
                run_id: runId,
                tool_input: toolCall.toolInput,
                skill: spec.skill,
                workspace_dir: workspaceDir,
                blocked: true,
                block_reason: allowlistReason,
              }),
              runId,
              personaId,
            });
            killProcessGroupOrChild(child);
            recordRun('failure');
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: spec.skill,
                reason: 'tool-not-in-allowlist',
                error: allowlistReason,
              },
              runId,
              personaId,
            });
            reject(new Error(allowlistReason));
            return;
          }
          const boundaryReason = workspaceBoundaryViolation({
            toolCall,
            workspaceDir,
            allowedSecondaryWorkspaces: spec.env?.FACTORY_ALLOWED_SECONDARY_WORKSPACES,
          });
          if (boundaryReason != null && !settled) {
            settled = true;
            clearTimeout(timeout);
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.tool-call',
              payload: normalizeToolCallAuditPayload({
                tool_name: toolCall.toolName,
                run_id: runId,
                tool_input: toolCall.toolInput,
                skill: spec.skill,
                workspace_dir: workspaceDir,
                blocked: true,
                block_reason: boundaryReason,
              }),
              runId,
              personaId,
            });
            killProcessGroupOrChild(child);
            recordRun('failure');
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: spec.skill,
                reason: 'workspace-boundary-violation',
                error: boundaryReason,
              },
              runId,
              personaId,
            });
            reject(new Error(boundaryReason));
            return;
          }
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.tool-call',
            payload: normalizeToolCallAuditPayload({
              tool_name: toolCall.toolName,
              run_id: runId,
              tool_input: toolCall.toolInput,
              skill: spec.skill,
              workspace_dir: workspaceDir,
            }),
            runId,
            personaId,
          });
          if (toolCallCount > spec.budgets.maxTurns && !settled) {
            settled = true;
            clearTimeout(timeout);
            killProcessGroupOrChild(child);
            recordRun('failure');
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: spec.skill,
                reason: 'tool-call-budget-exceeded',
                error: `tool-call budget exceeded: ${toolCallCount} > ${spec.budgets.maxTurns}`,
                toolCallsUsed: toolCallCount,
                maxToolCalls: spec.budgets.maxTurns,
              },
              runId,
              personaId,
            });
            reject(
              new Error(
                `Codex tool-call budget exceeded for run ${runId}: ${toolCallCount} > ${spec.budgets.maxTurns}`,
              ),
            );
          }
        } catch {
          /* non-JSON stdout lines are handled by parseCodexEnvelope at close */
        }
      };

      const appendRuntimeAdvisoryOnce = (line: string): boolean => {
        const advisory = detectRuntimeAdvisorySurface(line);
        if (advisory == null) return false;
        const key = advisory.surface;
        if (emittedRuntimeAdvisorySurfaces.has(key)) return true;
        emittedRuntimeAdvisorySurfaces.add(key);
        return appendRuntimeAdvisoryEvent({
          line,
          projectId,
          workItemId,
          runId,
          personaId,
          skill: spec.skill,
        });
      };

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrLineBuffer += text;
        const lines = stderrLineBuffer.split(/\r?\n/);
        stderrLineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const violation = handleForbiddenRuntimeSurface(line);
          if (violation != null) {
            failForbiddenRuntimeSurface(violation);
            return;
          }
          appendRuntimeAdvisoryOnce(line);
        }
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutLineBuffer += text;
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          handleStdoutLine(line);
          if (settled) return;
        }

        const remaining = STDOUT_CAP - stdout.length;
        if (remaining <= 0) {
          if (!truncated) {
            truncated = true;
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'tool.stdout-truncated',
              payload: { runId, skill: spec.skill },
              runId,
              personaId,
            });
          }
          return;
        }
        stdout += text.slice(0, remaining);
      });

      const effectiveTimeoutMs = spec.budgets.timeoutMs ?? TIMEOUT_MS;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessGroupOrChild(child);
        recordRun('failure');
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'tool.timeout',
          payload: { runId, skill: spec.skill },
          runId,
          personaId,
        });
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-failed',
          payload: {
            runId,
            skill: spec.skill,
            error: `timed out after ${effectiveTimeoutMs}ms`,
            timeoutMs: effectiveTimeoutMs,
          },
          runId,
          personaId,
        });
        reject(new Error(`Agent run ${runId} timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        handleStdoutLine(stdoutLineBuffer);
        stdoutLineBuffer = '';
        if (stderrLineBuffer.length > 0) {
          const violation = handleForbiddenRuntimeSurface(stderrLineBuffer);
          if (violation != null) {
            emitForbiddenRuntimeSurfaceBlocked(violation);
            recordRun('failure');
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: spec.skill,
                reason: 'forbidden-runtime-surface',
                error: violation.blockReason,
              },
              runId,
              personaId,
            });
            reject(new Error(violation.blockReason));
            return;
          }
          appendRuntimeAdvisoryOnce(stderrLineBuffer);
        }

        const envelope = parseCodexEnvelope(stdout);

        if (code !== 0 && envelope == null) {
          if (stderrIncludesNativePatchRejection(stderr)) emitNativePatchBlocked();
          recordRun('failure');
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, skill: spec.skill, exitCode: code },
            runId,
            personaId,
          });
          reject(
            new Error(`Codex CLI exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`),
          );
          return;
        }

        if (envelope?.isError) {
          if (stderrIncludesNativePatchRejection(stderr)) emitNativePatchBlocked();
          recordRun('failure');
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, skill: spec.skill, exitCode: code },
            runId,
            personaId,
          });
          const detail =
            envelope.errorDetail ?? envelope.result ?? (stderr.trim() || null) ?? 'no detail';
          reject(new Error(`Codex reported an error: ${detail}`));
          return;
        }

        const usageInputTokens = envelope?.usage.inputTokens ?? 0;
        const usageOutputTokens = envelope?.usage.outputTokens ?? 0;
        const usageCachedInputTokens = envelope?.usage.cachedInputTokens ?? 0;
        const usageCacheCreationInputTokens = envelope?.usage.cacheCreationInputTokens ?? 0;
        const usageReasoningOutputTokens = envelope?.usage.reasoningOutputTokens ?? 0;
        const rawCostUsd = envelope?.usage.costUsd ?? null;
        const costUsd =
          rawCostUsd ??
          estimateCostUsd(model, usageInputTokens, usageOutputTokens, {
            cachedInputTokens: usageCachedInputTokens,
            reasoningOutputTokens: usageReasoningOutputTokens,
          });
        const costLabel: 'estimated' | 'exact' = 'estimated';

        recordCost({
          runId,
          projectId,
          workItemId,
          stage: stageForSkill(spec.skill),
          skill: spec.skill,
          modelId: model,
          inputTokens: usageInputTokens,
          outputTokens: usageOutputTokens,
          cachedInputTokens: usageCachedInputTokens,
          cacheCreationInputTokens: usageCacheCreationInputTokens,
          reasoningOutputTokens: usageReasoningOutputTokens,
          costUsd,
          costLabel,
          personaId: personaId ?? null,
        });
        recordToolStatsForRun(runId);

        const exceededBudget = emitBudgetExceededIfNeeded({
          runId,
          skill: spec.skill,
          modelId: model,
          costUsd,
          maxBudgetUsd: spec.budgets.maxBudgetUsd,
          inputTokens: usageInputTokens,
          outputTokens: usageOutputTokens,
          projectId,
          workItemId,
          personaId,
        });

        if (exceededBudget) {
          const budgetExceeded = {
            costUsd,
            budgetUsd: spec.budgets.maxBudgetUsd,
            overByUsd: Number((costUsd - spec.budgets.maxBudgetUsd).toFixed(6)),
          };
          if (spec.budgetPolicy?.onPostRunExceeded === 'return-output') {
            recordRun('failure');
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: spec.skill,
                reason: 'budget-exceeded',
                error: `budget exceeded: $${costUsd} > $${spec.budgets.maxBudgetUsd}`,
                costUsd,
                budgetUsd: spec.budgets.maxBudgetUsd,
              },
              runId,
              personaId,
            });
            resolve({
              output: extractResultJson(envelope == null ? stdout : (envelope.result ?? ''), runId),
              decisionSummaries: [],
              events: eventStore.replay({ runId }),
              budgetExceeded,
            });
            return;
          }
          recordRun('failure');
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: {
              runId,
              skill: spec.skill,
              reason: 'budget-exceeded',
              error: `budget exceeded: $${costUsd} > $${spec.budgets.maxBudgetUsd}`,
              costUsd,
              budgetUsd: spec.budgets.maxBudgetUsd,
            },
            runId,
            personaId,
          });
          reject(
            new Error(
              `Agent run ${runId} exceeded budget: $${costUsd} > $${spec.budgets.maxBudgetUsd}`,
            ),
          );
          return;
        }

        const rawStderrTrimmed = stderr.trim();
        if (rawStderrTrimmed.length > 0) {
          if (stderrIncludesNativePatchRejection(rawStderrTrimmed)) emitNativePatchBlocked();
          const stderrTrimmed = filterRuntimeAdvisoryStderr(rawStderrTrimmed).trim();
          if (stderrTrimmed.length > 0) {
            eventStore.appendEvent({
              projectId,
              workItemId,
              kind: 'agent.log',
              payload: {
                runId,
                skill: spec.skill,
                stream: 'stderr',
                text: stderrTrimmed.slice(0, 4000),
              },
              runId,
              personaId,
            });
          }
        }

        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-completed',
          payload: {
            runId,
            skill: spec.skill,
            runtime: 'codex-cli',
            cost: {
              usd: costUsd,
              inputTokens: usageInputTokens,
              outputTokens: usageOutputTokens,
              cachedInputTokens: usageCachedInputTokens,
              cacheCreationInputTokens: usageCacheCreationInputTokens,
              reasoningOutputTokens: usageReasoningOutputTokens,
              label: costLabel,
            },
            turns: {
              used: envelope?.numTurns ?? null,
              budgeted: spec.budgets.maxTurns,
            },
            budget: {
              usd: spec.budgets.maxBudgetUsd,
            },
            ...spec.extraEventPayload,
          },
          runId,
          personaId,
        });

        recordRun('success');
        resolve({
          output: extractResultJson(envelope == null ? stdout : (envelope.result ?? ''), runId),
          decisionSummaries: [],
          events: eventStore.replay({ runId }),
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        recordRun('failure');
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-failed',
          payload: {
            runId,
            skill: spec.skill,
            reason: 'spawn-error',
            error: err.message,
          },
          runId,
          personaId,
        });
        reject(err);
      });
    });
  }
}

function completeLinePrefix(text: string): string {
  const lastNewline = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
  return lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
}
