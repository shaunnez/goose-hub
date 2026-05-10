import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { costFromCliEnvelope } from '../cost/extract.js';
import { recordCost } from '../cost/repository.js';
import { stageForSkill } from '../cost/skill-stage.js';
import { eventStore } from '../event-stream/store.js';
import { computeAllowlist } from '../tool-layer/allowlist.js';
import { deployDecisionCaptureHook } from '../tool-layer/decision-capture-hook.js';
import { deployHooks } from '../tool-layer/pre-tool-use-hook.js';
import { writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { getRecordDecisionTool } from '../db/repositories/project-settings.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { resolveMockOutput } from './mock-outputs.js';
import { defaultModelForTierAndProvider } from './models.js';

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 30_000; // 30 seconds — FACTORY_RULES rule 32
const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');
const MCP_CONFIG_PATH = join(homedir(), '.factory', 'mcp-config.json');
const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');

export class CodexBinaryNotFoundError extends Error {
  constructor() {
    super(
      "Binary 'codex' not found on PATH. Install the OpenAI Codex CLI " +
        '(https://github.com/openai/codex) or set the CODEX_BIN env var to its absolute path.',
    );
    this.name = 'CodexBinaryNotFoundError';
  }
}

export class CodexNotAuthenticatedError extends Error {
  constructor() {
    super(
      `Codex CLI is not authenticated. Run 'codex login' once on this machine to sign in with ChatGPT; the OAuth token is stored at ${CODEX_AUTH_PATH}.`,
    );
    this.name = 'CodexNotAuthenticatedError';
  }
}

/**
 * Resolves the absolute path to the `codex` binary.
 * Honours CODEX_BIN override; otherwise looks up via PATH (`where` on Windows, `which` on Unix).
 */
export function resolveCodexBinary(): string {
  const override = process.env.CODEX_BIN;
  if (override != null && override.length > 0) {
    if (!existsSync(override)) {
      throw new CodexBinaryNotFoundError();
    }
    return override;
  }
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(cmd, ['codex'], { encoding: 'utf8' }).trim();
    return result.split(/\r?\n/)[0];
  } catch {
    throw new CodexBinaryNotFoundError();
  }
}

/**
 * Pre-flight check: assert the user has authenticated with Codex either via
 * OAuth (`codex login` writes `~/.codex/auth.json`) or via `OPENAI_API_KEY`
 * env var (key-based auth path). Either is sufficient.
 */
export function assertCodexAuthenticated(): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey != null && apiKey.length > 0) return;
  if (!existsSync(CODEX_AUTH_PATH)) {
    throw new CodexNotAuthenticatedError();
  }
}

/**
 * Escapes a string for embedding inside a TOML multi-line basic string
 * (`"""..."""`). Multi-line basic strings carry literal newlines, so we only
 * need to neutralise backslashes (TOML's escape character) and any embedded
 * triple-quote sequence (which would terminate the string prematurely).
 */
export function escapeForTomlMultilineBasic(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
}

/**
 * Builds argv for `codex exec` invocation. Isolated for unit testing — the
 * exact flag set is version-dependent and may need revision against a live
 * binary (see ADR 0036 §1).
 */
export function buildCodexArgv(input: {
  model: string;
  workspaceDir: string;
  prompt: string;
  systemPrompt?: string;
  /** Reserved for future use; Codex `exec --json` does not currently accept turn caps. */
  maxTurns?: number;
}): string[] {
  const argv: string[] = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--cd',
    input.workspaceDir,
    '--model',
    input.model,
  ];
  if (input.systemPrompt != null) {
    // `-c` is Codex's per-invocation override for `instructions`. We use a
    // TOML multi-line basic string (triple-quoted) so prompts can carry raw
    // newlines without escaping; only `\` and any embedded `"""` need escape.
    argv.push('-c', `instructions="""${escapeForTomlMultilineBasic(input.systemPrompt)}"""`);
  }
  argv.push(input.prompt);
  return argv;
}

interface CodexEnvelope {
  result: string | null;
  isError: boolean;
  errorDetail: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  numTurns: number | null;
}

/**
 * Best-effort parser for the `codex exec --json` output. Codex emits either
 * a single JSON envelope or a stream of newline-delimited events terminating
 * in a final summary; we accept either. Field aliases probed in order.
 *
 * Returns `null` when stdout is not parseable as JSON at all — the caller
 * surfaces that as a typed runtime error.
 */
export function parseCodexEnvelope(stdout: string): CodexEnvelope | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  // Try a single JSON envelope first.
  let envelope: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed != null && typeof parsed === 'object') {
      envelope = parsed as Record<string, unknown>;
    }
  } catch {
    /* not a single envelope — try NDJSON */
  }

  // NDJSON: take the last terminal event with summary fields.
  if (envelope == null) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as unknown;
        if (parsed != null && typeof parsed === 'object') {
          const candidate = parsed as Record<string, unknown>;
          // Look for a terminal event: has `result` / `output` / `usage` or `error`.
          if (
            'result' in candidate ||
            'output' in candidate ||
            'usage' in candidate ||
            'error' in candidate
          ) {
            envelope = candidate;
            break;
          }
        }
      } catch {
        /* non-JSON line — ignore */
      }
    }
  }

  if (envelope == null) return null;

  const result =
    pickString(envelope, ['result', 'output', 'text']) ??
    pickString(envelope, ['final_message', 'finalMessage']) ??
    null;

  const errorField = envelope.error;
  let isError = false;
  let errorDetail: string | null = null;
  if (typeof errorField === 'string' && errorField.length > 0) {
    isError = true;
    errorDetail = errorField;
  } else if (typeof errorField === 'boolean') {
    isError = errorField;
  } else if (errorField != null && typeof errorField === 'object') {
    isError = true;
    const obj = errorField as Record<string, unknown>;
    errorDetail =
      pickString(obj, ['message', 'detail', 'reason']) ?? JSON.stringify(errorField).slice(0, 800);
  }

  // Cost extraction reuses the existing alias-probing logic. costFromCliEnvelope
  // already handles `usage.input_tokens` / `usage.output_tokens` / `total_cost_usd`
  // and tolerates unknown shapes.
  const cost = costFromCliEnvelope(envelope);

  const numTurns = pickNumber(envelope, ['num_turns', 'turns']);

  return {
    result,
    isError,
    errorDetail,
    usage: {
      inputTokens: cost?.inputTokens ?? 0,
      outputTokens: cost?.outputTokens ?? 0,
      costUsd: cost?.costUsd ?? null,
    },
    numTurns,
  };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Extracts the JSON value the agent returned. Mirrors the Claude runtime's
 * `extractResultJson` — handles bare JSON, markdown-fenced blocks, and falls
 * back to the raw string so the schema validator surfaces a clear type error.
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
  const preview = text.slice(0, 800);
  console.error(
    `[agent-runtime] extractResultJson (codex) fallback to raw string runId=${runId} preview=${JSON.stringify(preview)}`,
  );
  return text;
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

        const envelope = parseCodexEnvelope(stdout);

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
            new Error(`Codex CLI exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`),
          );
          return;
        }

        if (envelope?.isError) {
          eventStore.appendEvent({
            projectId,
            workItemId,
            kind: 'agent.run-failed',
            payload: { runId, exitCode: code },
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
        const costUsd = envelope?.usage.costUsd ?? 0;
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
