import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { eventStore } from '../event-stream/store.js';
import { computeAllowlist } from '../tool-layer/allowlist.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';
import { defaultModelForTier } from './models.js';
import type { JsonSchema } from './schema-bridge.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const MCP_CONFIG_PATH = join(homedir(), '.factory', 'mcp-config.json');

/** Bundle name → workspace-relative MCP config path. */
const MCP_CONFIG_FOR_BUNDLE: Record<string, string> = {
  'playwright-mcp': 'apps/web/.mcp.json',
};

/**
 * Resolves which MCP config to pass via --mcp-config based on the spec's tool bundles.
 * When a bundle is mapped to a workspace-relative path AND that file exists, that path
 * is returned. Otherwise the global empty MCP config is used.
 */
export function resolveMcpConfigPath(workspaceDir: string, toolBundles: string[]): string {
  for (const bundle of toolBundles) {
    const relPath = MCP_CONFIG_FOR_BUNDLE[bundle];
    if (relPath == null) continue;
    const candidate = join(workspaceDir, relPath);
    if (existsSync(candidate)) return candidate;
  }
  return MCP_CONFIG_PATH;
}

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
  // Could not parse as JSON — return raw string so the schema validator
  // surfaces a clear type error. Log the preview here so the raw output
  // is visible in server logs even if the caller's error message is truncated.
  const preview = text.slice(0, 800);
  console.error(
    `[agent-runtime] extractResultJson fallback to raw string runId=${runId} preview=${JSON.stringify(preview)}`,
  );
  return text;
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
      personaId: spec.personaId,
    });

    const { contextXml } = assembleSpawnContext(spec);
    const allowedTools = computeAllowlist(spec);
    const model = spec.modelOverride ?? defaultModelForTier('sonnet');
    const mcpConfigPath =
      spec.mcpConfigPath ?? resolveMcpConfigPath(workspaceDir, spec.toolBundles);

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
    const { personaId } = spec;

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
        // Where the pre-tool-use-hook posts tool-call audit events (#209).
        // Falls back to 3001 if FACTORY_SERVER_PORT isn't set in the parent.
        FACTORY_SERVER_PORT: process.env.FACTORY_SERVER_PORT ?? '3001',
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
          payload: { runId },
          runId,
          personaId,
        });
        reject(new Error(`Agent run ${runId} timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      child.on('close', (code) => {
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
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, exitCode: code },
            runId,
            personaId,
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
            personaId,
          });
          const detail =
            envelope.result ??
            envelope.errors?.join('; ') ??
            (envelope.subtype != null ? `subtype: ${envelope.subtype}` : null) ??
            (stderr.trim() || null) ??
            'no detail available';
          reject(new Error(`Claude reported an error: ${detail}`));
          return;
        }

        eventStore.appendEvent({
          projectId,
          workItemId,
          kind: 'agent.run-completed',
          payload: { runId, skill: spec.skill },
          runId,
          personaId,
        });

        resolve({
          output: extractResultJson(envelope?.result ?? stdout, runId),
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
