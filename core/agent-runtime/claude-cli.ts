import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eventStore } from '../event-stream/store.js';
import { computeAllowlist } from '../tool-layer/allowlist.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { defaultModelForTier } from './models.js';
import type { JsonSchema } from './schema-bridge.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

/**
 * Resolves the absolute path to the `claude` binary.
 * Security rule: never rely on implicit PATH — resolve explicitly.
 */
function resolveBinary(name: string): string {
  try {
    // Uses `which` (POSIX) to get the absolute path
    return execFileSync('which', [name], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`Binary '${name}' not found on PATH. Install the Claude CLI first.`);
  }
}

export class ClaudeCliRuntime implements AgentRuntime {
  async run(spec: AgentSpec): Promise<AgentResult> {
    const jsonSchema = spec.outputJsonSchema;
    const { runId } = spec;
    const workspaceDir = join(WORKSPACES_DIR, runId);

    // Bootstrap workspace
    mkdirSync(workspaceDir, { recursive: true });
    writeWorkspaceSandbox(workspaceDir);
    deployHooks();

    // Emit run-started
    eventStore.appendEvent({
      projectId: spec.context['projectId'] as string ?? 'unknown',
      workItemId: spec.context['workItemId'] as string ?? null,
      kind: 'agent.run-started',
      payload: { skill: spec.skill, runId },
      runId,
    });

    const { contextXml } = assembleSpawnContext(spec);
    const allowedTools = computeAllowlist(spec);
    const model = spec.modelOverride ?? defaultModelForTier('sonnet');

    // Build argv array — Security rule: never use shell: true
    const binaryPath = resolveBinary('claude');
    const argv: string[] = [
      '--print',
      '--no-session-persistence',
      '--max-turns', String(spec.budgets.maxTurns),
      '--max-budget-usd', String(spec.budgets.maxBudgetUsd),
      '--model', model,
      '--output-format', 'json',
    ];

    if (allowedTools.length > 0) {
      argv.push('--allowedTools', allowedTools.join(','));
    }

    if (jsonSchema != null && Object.keys(jsonSchema).length > 0) {
      argv.push('--json-schema', JSON.stringify(jsonSchema));
    }

    // Per-run context as the user message
    argv.push(contextXml);

    const projectId = spec.context['projectId'] as string ?? 'unknown';
    const workItemId = spec.context['workItemId'] as string ?? null;

    return new Promise((resolve, reject) => {
      // Security rule: minimal explicit env, no parent process.env passthrough
      const minimalEnv: Record<string, string> = {
        HOME: homedir(),
        PATH: '/usr/local/bin:/usr/bin:/bin',
        FACTORY_RUN_ALLOWLIST: allowedTools.join(','),
        FACTORY_RUN_ID: runId,
      };
      if (process.env.ANTHROPIC_API_KEY != null) {
        minimalEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      }

      const child = spawn(binaryPath, argv, {
        env: minimalEnv,
        cwd: workspaceDir,
        shell: false, // Security rule: never shell: true
      });

      let stdout = '';
      let truncated = false;

      child.stdout.on('data', (chunk: Buffer) => {
        const remaining = STDOUT_CAP - stdout.length;
        if (remaining <= 0) {
          if (!truncated) {
            truncated = true;
            eventStore.appendEvent({ projectId, workItemId, kind: 'tool.stdout-truncated', payload: { runId }, runId });
          }
          return;
        }
        stdout += chunk.slice(0, remaining).toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        eventStore.appendEvent({ projectId, workItemId, kind: 'tool.timeout', payload: { runId }, runId });
        reject(new Error(`Agent run ${runId} timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          eventStore.appendEvent({ projectId, workItemId, kind: 'agent.run-failed', payload: { runId, exitCode: code }, runId });
          reject(new Error(`Claude CLI exited with code ${code}`));
          return;
        }

        eventStore.appendEvent({ projectId, workItemId, kind: 'agent.run-completed', payload: { runId }, runId });
        resolve({
          output: (() => { try { return JSON.parse(stdout); } catch { return stdout; } })(),
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
