import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const MCP_CONFIG_PATH = join(homedir(), '.factory', 'mcp-config.json');

/**
 * Resolves the absolute path to the `claude` binary.
 * Security rule: never rely on implicit PATH — resolve explicitly.
 */
function resolveBinary(name: string): string {
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`Binary '${name}' not found on PATH. Install the Claude CLI first.`);
  }
}

/**
 * Extracts a JSON value from a result string.
 * Handles direct JSON and markdown-fenced JSON blocks (```json ... ```).
 */
function extractResultJson(text: string): unknown {
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
  return text;
}

export class ClaudeCliRuntime implements AgentRuntime {
  async run(spec: AgentSpec): Promise<AgentResult> {
    const jsonSchema = spec.outputJsonSchema;
    const { runId } = spec;
    const workspaceDir = join(WORKSPACES_DIR, runId);

    // Bootstrap workspace
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(MCP_CONFIG_PATH, '{"mcpServers":{}}', { flag: 'w' });
    writeWorkspaceSandbox(workspaceDir);
    deployHooks();

    // Emit run-started
    eventStore.appendEvent({
      projectId: (spec.context.projectId as string) ?? 'unknown',
      workItemId: (spec.context.workItemId as string) ?? null,
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
      '--max-turns',
      String(spec.budgets.maxTurns),
      '--max-budget-usd',
      String(spec.budgets.maxBudgetUsd),
      '--model',
      model,
      '--output-format',
      'json',
      '--mcp-config',
      MCP_CONFIG_PATH,
      '--strict-mcp-config',
    ];

    // --system-prompt replaces the default IDE system prompt so the agent follows
    // the skill's instructions rather than responding as a general coding assistant.
    if (spec.appendSystemPrompt != null) {
      argv.push('--system-prompt', spec.appendSystemPrompt);
    }

    if (allowedTools.length > 0) {
      argv.push('--allowedTools', allowedTools.join(','));
    }

    if (jsonSchema != null && Object.keys(jsonSchema).length > 0) {
      argv.push('--json-schema', JSON.stringify(jsonSchema));
    }

    // Per-run context as the user message
    argv.push(contextXml);

    const projectId = (spec.context.projectId as string) ?? 'unknown';
    const workItemId = (spec.context.workItemId as string) ?? null;

    return new Promise((resolve, reject) => {
      // Security rule: minimal explicit env, no parent process.env passthrough.
      // USER and TMPDIR are required for macOS OAuth keychain credential lookup.
      const minimalEnv: Record<string, string> = {
        HOME: homedir(),
        USER: process.env.USER ?? '',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
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
              payload: { runId },
              runId,
            });
          }
          return;
        }
        stdout += chunk.slice(0, remaining).toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'tool.timeout',
          payload: { runId },
          runId,
        });
        reject(new Error(`Agent run ${runId} timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);

        // --output-format json produces a single JSON envelope:
        // { is_error: bool, result: string, session_id: string, ... }
        let envelope: { is_error: boolean; result: string } | undefined;
        try {
          envelope = JSON.parse(stdout) as { is_error: boolean; result: string };
        } catch {
          /* not valid JSON — fall through to exit-code check */
        }

        if (code !== 0 && envelope == null) {
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, exitCode: code },
            runId,
          });
          reject(
            new Error(`Claude CLI exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`),
          );
          return;
        }

        if (envelope?.is_error) {
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, exitCode: code },
            runId,
          });
          reject(new Error(`Claude reported an error: ${envelope.result}`));
          return;
        }

        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-completed',
          payload: { runId },
          runId,
        });

        resolve({
          output: extractResultJson(envelope?.result ?? stdout),
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
