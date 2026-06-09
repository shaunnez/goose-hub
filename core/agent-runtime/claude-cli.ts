import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { costFromCliEnvelope } from '../cost/extract.js';
import { recordCost, recordToolStatsForRun } from '../cost/repository.js';
import { stageForSkill } from '../cost/skill-stage.js';
import { getRecordDecisionTool } from '../db/repositories/project-settings.js';
import { eventStore } from '../event-stream/store.js';
import { deployDecisionCaptureHook } from '../tool-layer/decision-capture-hook.js';
import { buildFactoryMcpConfig, buildMcpRemoteConfig } from '../tool-layer/mcp/build-config.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { bindToolsForAgentSpec } from '../tool-layer/tool-binding.js';
import { emitBudgetExceededIfNeeded } from './budget-guard.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';
import { defaultModelForTier } from './models.js';
import { killProcessGroupOrChild } from './process-kill.js';
import { recordAgentRun } from './run-record.js';
import { withFactoryRuntimeInstructions } from './runtime-instructions.js';
import type { JsonSchema } from './schema-bridge.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const OUTPUT_SCHEMAS_DIR = join('.factory', 'output-schemas');

/**
 * Resolves the absolute path to the `claude` binary.
 * Security rule: never rely on implicit PATH — resolve explicitly.
 * Uses `where` on Windows, `which` on Unix.
 */
function resolveBinary(name: string): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(cmd, [name], { encoding: 'utf8' }).trim();
    // `where` on Windows may return multiple lines; take the first match.
    return result.split(/\r?\n/)[0];
  } catch {
    throw new Error(`Binary '${name}' not found on PATH. Install the Claude CLI first.`);
  }
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

function outputSchemaHash(schema: JsonSchema | undefined): string | undefined {
  if (schema == null || Object.keys(schema).length === 0) return undefined;
  return createHash('sha256').update(stableJson(schema)).digest('hex').slice(0, 16);
}

function toClaudeAllowedToolName(toolName: string): string {
  if (toolName === 'mcp__factory-tools__repo_intel.query') {
    return 'mcp__factory-tools__repo_intel_query';
  }
  return toolName;
}

/**
 * Extracts a JSON value from a result string.
 * Handles direct JSON and markdown-fenced JSON blocks (```json ... ```).
 * Returns the raw string when parsing fails — callers must handle this case.
 */
function extractResultJson(text: string, runId: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      /* continue */
    }
  }
  // Strip [decision] marker lines emitted before the JSON object and retry.
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('[decision]'))
    .join('\n')
    .trim();
  if (stripped !== text.trim()) {
    try {
      return JSON.parse(stripped);
    } catch {
      /* continue */
    }
  }
  // Last resort: extract the outermost {...} block.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }
  // Could not parse as JSON — return raw string so the schema validator
  // surfaces a clear type error. Log the preview here so the raw output
  // is visible in server logs even if the caller's error message is truncated.
  const preview = text.slice(0, 800);
  console.error(
    `[agent-runtime] extractResultJson fallback to raw string runId=${runId} preview=${JSON.stringify(preview)}`,
  );
  return text;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

interface SidecarHandle {
  port: number;
  kill: () => void;
}

function spawnHttpSidecar(
  sidecarEnv: Record<string, string>,
  orchestratorRoot: string,
): SidecarHandle {
  const serverScript = join(orchestratorRoot, 'core/tool-layer/mcp/server.ts');
  const localCli = join(orchestratorRoot, 'node_modules/tsx/dist/cli.mjs');
  const port = Number.parseInt(sidecarEnv.FACTORY_SERVER_PORT, 10);

  const child: ChildProcess = spawn(process.execPath, [localCli, serverScript], {
    env: { ...sidecarEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: false,
  });

  return {
    port,
    kill: () => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    },
  };
}

function waitForSidecar(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = new Socket();
      sock.setTimeout(200);
      sock.connect(port, '127.0.0.1', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`factory-tools HTTP sidecar did not start on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 100);
        }
      });
      sock.on('timeout', () => {
        sock.destroy();
        setTimeout(attempt, 100);
      });
    }
    attempt();
  });
}

function inferOrchestratorRoot(): string {
  // core/agent-runtime/claude-cli.ts → core/agent-runtime → core → <repo root>
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export class ClaudeCliRuntime implements AgentRuntime {
  async run(spec: AgentSpec): Promise<AgentResult> {
    if (process.env.MOCK_AGENTS === 'true') {
      return resolveMockOutput(spec);
    }

    const jsonSchema = spec.outputJsonSchema;
    const { runId } = spec;
    const workspaceDir = spec.workspaceDir ?? join(WORKSPACES_DIR, runId);

    // Bootstrap workspace
    mkdirSync(workspaceDir, { recursive: true });
    const projectId = (spec.context.projectId as string) ?? 'unknown';
    const workItemId = (spec.context.workItemId as string | undefined) ?? spec.workItemId ?? null;
    const toolBinding = bindToolsForAgentSpec(spec);
    // Per-run MCP config under <worktree>/.factory/mcp-config.json (ADR 0045).
    // Always written; the factory-tools server entry carries the run's
    // identity via env.
    const useMcpRemote = process.env.FACTORY_USE_MCP_REMOTE === '1';
    let sidecar: SidecarHandle | null = null;
    let factoryMcpConfigPath: string;

    if (useMcpRemote) {
      const port = await findFreePort();
      const remoteResult = buildMcpRemoteConfig({
        workspaceDir,
        runId,
        projectId,
        workItemId,
        skill: spec.skill,
        personaId: spec.personaId,
        port,
      });
      factoryMcpConfigPath = remoteResult.configPath;

      const sidecarEnvPath = join(workspaceDir, '.factory/mcp-sidecar.env.json');
      const sidecarEnv = JSON.parse(readFileSync(sidecarEnvPath, 'utf8')) as Record<string, string>;
      sidecar = spawnHttpSidecar(sidecarEnv, inferOrchestratorRoot());
      await waitForSidecar(port);
    } else {
      const result = buildFactoryMcpConfig({
        workspaceDir,
        runId,
        projectId,
        workItemId,
        skill: spec.skill,
        personaId: spec.personaId,
        toolBundles: toolBinding.mcpServerBundles,
      });
      factoryMcpConfigPath = result.configPath;
    }
    const recordDecisionTool = getRecordDecisionTool(projectId);
    if (spec.sandboxMode !== 'preconfigured') {
      writeWorkspaceSandbox(workspaceDir, { role: spec.role, recordDecisionTool });
    }
    deployHooks(); // always — writes to ~/.factory/hooks/, not workspace-specific
    if (recordDecisionTool) deployDecisionCaptureHook();

    const model = spec.modelOverride ?? defaultModelForTier('sonnet');
    const outputSchemaPath =
      jsonSchema != null && Object.keys(jsonSchema).length > 0
        ? outputSchemaPathForRun(workspaceDir, runId)
        : undefined;
    if (outputSchemaPath != null) {
      mkdirSync(dirname(outputSchemaPath), { recursive: true });
      writeFileSync(outputSchemaPath, `${JSON.stringify(jsonSchema, null, 2)}\n`, { flag: 'w' });
    }
    const schemaHash = outputSchemaHash(jsonSchema);

    // Emit run-started
    if (spec.suppressRunStarted !== true) {
      eventStore.appendEvent({
        projectId,
        workItemId,
        kind: 'agent.run-started',
        payload: {
          skill: spec.skill,
          runId,
          personaId: spec.personaId,
          modelId: model,
          runtime: 'claude-cli',
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
        personaId: spec.personaId,
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
        personaId: spec.personaId,
      });
    }

    const { contextXml } = assembleSpawnContext(spec);
    const allowedTools = toolBinding.allowlist;
    const claudeAllowedTools = allowedTools.map(toClaudeAllowedToolName);
    const mcpConfigPath = spec.mcpConfigPath ?? factoryMcpConfigPath;

    // Build argv array — Security rule: never use shell: true
    const binaryPath = resolveBinary('claude');
    const argv: string[] = [
      '--print',
      '--no-session-persistence',
      '--max-turns',
      String(spec.budgets.maxTurns),
      '--max-budget-usd',
      String(spec.budgets.maxBudgetUsd),
      '--model',
      model,
      '--output-format',
      'json',
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
    ];

    // --system-prompt replaces the default IDE system prompt so the agent follows
    // Factory runtime invariants and the skill's instructions rather than responding
    // as a general coding assistant.
    argv.push('--system-prompt', withFactoryRuntimeInstructions(spec.appendSystemPrompt));

    // Pass --allowedTools whenever bundles were explicitly declared, even if they
    // resolve to an empty list. An empty list means "no tools" (e.g. grill-me uses
    // the 'core' bundle which grants no filesystem access). Omitting the flag
    // entirely would leave the agent unrestricted.
    if (spec.toolBundles.length > 0 || claudeAllowedTools.length > 0) {
      argv.push('--allowedTools', claudeAllowedTools.join(','));
    }

    if (jsonSchema != null && Object.keys(jsonSchema).length > 0) {
      argv.push('--json-schema', JSON.stringify(jsonSchema));
    }
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

    return new Promise((resolve, reject) => {
      // Security rule: minimal explicit env, no parent process.env passthrough.
      // USER/USERNAME and TMPDIR/TEMP are required for OAuth keychain credential lookup.
      const isWindows = process.platform === 'win32';
      const minimalEnv: Record<string, string> = {
        HOME: homedir(),
        ...(isWindows
          ? {
              USERNAME: process.env.USERNAME ?? '',
              USERPROFILE: homedir(),
              TEMP: process.env.TEMP ?? homedir(),
              TMP: process.env.TMP ?? homedir(),
              // Include the binary's directory plus Windows system dirs for Claude CLI's own needs.
              PATH: `${dirname(binaryPath)};C:\\Windows\\System32;C:\\Windows`,
              APPDATA: process.env.APPDATA ?? '',
              LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
            }
          : {
              USER: process.env.USER ?? '',
              TMPDIR: process.env.TMPDIR ?? '/tmp',
              // /opt/homebrew/bin first so Apple Silicon Homebrew tools (pnpm, gh) resolve
              // before any shadowing entries in /usr/local/bin.
              PATH:
                process.platform === 'darwin'
                  ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
                  : '/usr/local/bin:/usr/bin:/bin',
            }),
        FACTORY_RUN_ALLOWLIST: allowedTools.join(','),
        FACTORY_RUN_ID: runId,
        FACTORY_PROJECT_ID: projectId,
        FACTORY_WORKSPACE_DIR: workspaceDir,
        // Where the pre-tool-use-hook posts tool-call audit events (#209).
        // Falls back to 3001 if FACTORY_SERVER_PORT isn't set in the parent.
        FACTORY_SERVER_PORT: process.env.FACTORY_SERVER_PORT ?? '3001',
        // iteration/phase for the decision-capture hook (M19.23).
        FACTORY_ITERATION: String(spec.iteration ?? 0),
        FACTORY_PHASE: spec.phase ?? '',
      };
      if (process.env.ANTHROPIC_API_KEY != null) {
        minimalEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      }
      if (spec.env) {
        Object.assign(minimalEnv, spec.env);
      }

      const child = spawn(binaryPath, argv, {
        env: minimalEnv,
        cwd: workspaceDir,
        detached: !isWindows,
        shell: false, // Security rule: never shell: true
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin?.end(contextXml);

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let settled = false;

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
        sidecar?.kill();
        reject(new Error(`Agent run ${runId} timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        // --output-format json produces a single JSON envelope:
        // { is_error: bool, result: string, session_id: string, ... }
        let envelope:
          | { is_error: boolean; result: string | null; subtype?: string; errors?: string[] }
          | undefined;
        try {
          envelope = JSON.parse(stdout) as typeof envelope;
        } catch {
          /* not valid JSON — fall through to exit-code check */
        }

        if (code !== 0 && envelope == null) {
          recordRun('failure');
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, skill: spec.skill, exitCode: code },
            runId,
            personaId,
          });
          sidecar?.kill();
          reject(
            new Error(`Claude CLI exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`),
          );
          return;
        }

        if (envelope?.is_error) {
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
            envelope.result ??
            envelope.errors?.join('; ') ??
            (envelope.subtype != null ? `subtype: ${envelope.subtype}` : null) ??
            (stderr.trim() || null) ??
            'no detail available';
          sidecar?.kill();
          reject(new Error(`Claude reported an error: ${detail}`));
          return;
        }

        const usage = envelope ? costFromCliEnvelope(envelope) : null;
        const turnsUsed =
          envelope != null && typeof (envelope as Record<string, unknown>).num_turns === 'number'
            ? ((envelope as Record<string, unknown>).num_turns as number)
            : null;
        recordCost({
          runId,
          projectId,
          workItemId,
          stage: stageForSkill(spec.skill),
          skill: spec.skill,
          modelId: model,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
          reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0,
          costUsd: usage?.costUsd ?? 0,
          // No CLI usage data → still 'estimated', just zeroed.
          costLabel: usage?.costLabel ?? 'estimated',
          personaId: personaId ?? null,
        });
        recordToolStatsForRun(runId);

        const costUsd = usage?.costUsd ?? 0;
        const inputTokens = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        const exceededBudget = emitBudgetExceededIfNeeded({
          runId,
          skill: spec.skill,
          modelId: model,
          costUsd,
          maxBudgetUsd: spec.budgets.maxBudgetUsd,
          inputTokens,
          outputTokens,
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
            sidecar?.kill();
            resolve({
              output: extractResultJson(envelope?.result ?? stdout, runId),
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
          sidecar?.kill();
          reject(
            new Error(
              `Agent run ${runId} exceeded budget: $${costUsd} > $${spec.budgets.maxBudgetUsd}`,
            ),
          );
          return;
        }

        // Surface non-empty stderr even on successful runs. The Claude CLI
        // forwards MCP server stderr (startup banners, registration warnings,
        // failed --strict-mcp-config diagnostics) here. Without this, an agent
        // can run with a silently-broken MCP server, return a free-text
        // apology, and leave operators with no signal in the event stream.
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
            cost: {
              usd: usage?.costUsd ?? 0,
              inputTokens: usage?.inputTokens ?? 0,
              outputTokens: usage?.outputTokens ?? 0,
              cachedInputTokens: usage?.cachedInputTokens ?? 0,
              cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
              reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0,
              label: usage?.costLabel ?? 'estimated',
            },
            turns: {
              used: turnsUsed,
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

        sidecar?.kill();
        resolve({
          output: extractResultJson(envelope?.result ?? stdout, runId),
          decisionSummaries: [],
          events: eventStore.replay({ runId }),
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        sidecar?.kill();
        reject(err);
      });
    });
  }
}
