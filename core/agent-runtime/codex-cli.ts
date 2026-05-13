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
} from './codex-parser.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';
import { defaultModelForTierAndProvider, estimateCostUsd } from './models.js';

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
  pickCodexAgentMessageText,
} from './codex-parser.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const MCP_CONFIG_PATH = join(homedir(), '.factory', 'mcp-config.json');

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
    writeWorkspaceSandbox(workspaceDir, { role: spec.role, recordDecisionTool });
    deployHooks();
    if (recordDecisionTool) deployDecisionCaptureHook();
    const workItemId = (spec.context.workItemId as string) ?? null;
    const { personaId } = spec;

    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'agent.run-started',
      payload: {
        skill: spec.skill,
        runId,
        personaId,
        runtime: 'codex-cli',
        ...spec.extraEventPayload,
      },
      runId,
      personaId,
    });

    const { contextXml } = assembleSpawnContext(spec);
    const allowedTools = computeAllowlist(spec);
    const model = spec.modelOverride ?? defaultModelForTierAndProvider('sonnet', 'codex');

    const argv = buildCodexArgv({
      model,
      workspaceDir,
      prompt: contextXml,
      systemPrompt: spec.appendSystemPrompt,
      maxTurns: spec.budgets.maxTurns,
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
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.stdout.on('data', (chunk: Buffer) => {
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
        stdout += chunk.slice(0, remaining).toString();
      });

      const effectiveTimeoutMs = spec.budgets.timeoutMs ?? TIMEOUT_MS;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'tool.timeout',
          payload: { runId, skill: spec.skill },
          runId,
          personaId,
        });
        reject(new Error(`Agent run ${runId} timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);

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
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
