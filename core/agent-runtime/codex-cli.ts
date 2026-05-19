import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { recordCost } from '../cost/repository.js';
import { stageForSkill } from '../cost/skill-stage.js';
import { getRecordDecisionTool } from '../db/repositories/project-settings.js';
import { eventStore } from '../event-stream/store.js';
import { computeAllowlist } from '../tool-layer/allowlist.js';
import { deployDecisionCaptureHook } from '../tool-layer/decision-capture-hook.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { normalizeToolCallAuditPayload } from '../tool-layer/tool-call-audit.js';
import { emitBudgetExceededIfNeeded } from './budget-guard.js';
import {
  CodexBinaryNotFoundError,
  CodexNotAuthenticatedError,
  assertCodexAuthenticated,
  buildCodexArgv,
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
const MCP_CONFIG_PATH = join(homedir(), '.factory', 'mcp-config.json');
const BROWSER_PROCESS_ACCESS_SKILLS = new Set(['playwright-repro', 'evidence-post']);
const ABSOLUTE_USER_PATH_RE = /\/Users\/[^\s'"`]+/g;

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
    writeFileSync(MCP_CONFIG_PATH, '{"mcpServers":{}}', { flag: 'w' });
    const projectId = (spec.context.projectId as string) ?? 'unknown';
    const recordDecisionTool = getRecordDecisionTool(projectId);
    if (spec.sandboxMode !== 'preconfigured') {
      writeWorkspaceSandbox(workspaceDir, { role: spec.role, recordDecisionTool });
    }
    deployHooks();
    if (recordDecisionTool) deployDecisionCaptureHook();
    const workItemId = (spec.context.workItemId as string | undefined) ?? spec.workItemId ?? null;
    const { personaId } = spec;
    const model = spec.modelOverride ?? defaultModelForTierAndProvider('sonnet', 'codex');

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
          ...spec.extraEventPayload,
        },
        runId,
        personaId,
      });
    }

    const { contextXml } = assembleSpawnContext(spec);
    const allowedTools = computeAllowlist(spec);
    const needsBrowserProcessAccess =
      spec.toolBundles.includes('validate') && BROWSER_PROCESS_ACCESS_SKILLS.has(spec.skill);

    const argv = buildCodexArgv({
      model,
      workspaceDir,
      prompt: contextXml,
      systemPrompt: withFactoryRuntimeInstructions(spec.appendSystemPrompt),
      maxTurns: spec.budgets.maxTurns,
      commandSandbox: needsBrowserProcessAccess ? 'danger-full-access' : undefined,
      approvalPolicy: needsBrowserProcessAccess ? 'never' : undefined,
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
        FACTORY_RUN_ALLOWLIST: allowedTools.join(','),
        FACTORY_RUN_ID: runId,
        FACTORY_PROJECT_ID: projectId,
        FACTORY_WORKSPACE_DIR: workspaceDir,
        FACTORY_SERVER_PORT: process.env.FACTORY_SERVER_PORT ?? '3001',
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
      let truncated = false;
      let settled = false;
      let toolCallCount = 0;
      const assistantMarkerOffsets = new Map<string, number>();

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

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
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

        const envelope = parseCodexEnvelope(stdout);

        if (code !== 0 && envelope == null) {
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
        const rawCostUsd = envelope?.usage.costUsd ?? null;
        const costUsd = rawCostUsd ?? estimateCostUsd(model, usageInputTokens, usageOutputTokens);
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
          costUsd,
          costLabel,
          personaId: personaId ?? null,
        });

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

        const stderrTrimmed = stderr.trim();
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
              label: costLabel,
            },
            turns: {
              used: envelope?.numTurns ?? null,
              budgeted: spec.budgets.maxTurns,
            },
            budget: {
              usd: spec.budgets.maxBudgetUsd,
            },
          },
          runId,
          personaId,
        });

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
        reject(err);
      });
    });
  }
}

function completeLinePrefix(text: string): string {
  const lastNewline = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
  return lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
}
