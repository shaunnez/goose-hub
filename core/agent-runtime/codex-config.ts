import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeEffort } from '../types.js';

const CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json');
const CODEX_DEFER_MCP_TOOLS_FEATURE = 'features.tool_search_always_defer_mcp_tools=true';

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
 * Builds `-c` flag pairs that register MCP servers with the Codex CLI.
 * Codex consumes MCP servers via TOML `[mcp_servers.<name>]` tables in
 * `~/.codex/config.toml`. We pass `--ignore-user-config` for hygiene,
 * so the per-run config is supplied inline via `-c key=value` flags.
 *
 * Each entry produces three `-c` pairs: `command`, `args` (as a TOML
 * array literal), and `env` (as a TOML inline table). Strings are
 * double-quoted with `\` and `"` escaped — keys are alphanumeric/`-`/`_`
 * only (server name) and TOML-safe (`command`, `args`, `env`).
 */
export function buildCodexMcpInlineArgs(
  servers: Record<
    string,
    {
      command: string;
      args: ReadonlyArray<string>;
      env?: Record<string, string>;
      enabledTools?: ReadonlyArray<string>;
      required?: boolean;
      startupTimeoutSec?: number;
      toolTimeoutSec?: number;
    }
  >,
): string[] {
  const out: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const base = `mcp_servers.${name}`;
    out.push('-c', `${base}.command=${tomlString(entry.command)}`);
    out.push('-c', `${base}.args=[${entry.args.map((a) => tomlString(a)).join(',')}]`);
    // Codex defaults to prompting for every MCP tool call. Factory-owned
    // servers are already gated by the run allowlist and PreToolUse hook,
    // so re-prompting per tool call would just cancel the run in `--ephemeral`
    // / `--ask-for-approval never` modes. Force pre-approval.
    out.push('-c', `${base}.default_tools_approval_mode=${tomlString('approve')}`);
    if (entry.required != null) {
      out.push('-c', `${base}.required=${String(entry.required)}`);
    }
    if (entry.startupTimeoutSec != null) {
      out.push('-c', `${base}.startup_timeout_sec=${String(entry.startupTimeoutSec)}`);
    }
    if (entry.toolTimeoutSec != null) {
      out.push('-c', `${base}.tool_timeout_sec=${String(entry.toolTimeoutSec)}`);
    }
    if (entry.enabledTools != null) {
      out.push(
        '-c',
        `${base}.enabled_tools=[${entry.enabledTools.map((tool) => tomlString(tool)).join(',')}]`,
      );
    }
    if (entry.env != null && Object.keys(entry.env).length > 0) {
      const inline = Object.entries(entry.env)
        .map(([k, v]) => `${tomlBareKey(k)}=${tomlString(v)}`)
        .join(',');
      out.push('-c', `${base}.env={${inline}}`);
    }
  }
  return out;
}

function tomlString(value: string): string {
  // TOML basic string: escape `\` and `"`. Other characters pass through
  // literally; agent-supplied content is never routed here (server name,
  // command path, env keys/values are all Factory-owned).
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlBareKey(value: string): string {
  // TOML bare keys are [A-Za-z0-9_-]. Env var names match. Anything else
  // gets quoted as a basic string for safety.
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
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
  effort?: RuntimeEffort;
  /** Reserved for future use; Codex `exec --json` does not currently accept turn caps. */
  maxTurns?: number;
  /** Optional Codex CLI sandbox mode for model-generated shell commands. */
  commandSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Optional global approval policy. Must be placed before the `exec` subcommand. */
  approvalPolicy?: 'never';
  /** Trust Factory-generated project hooks without relying on user-global Codex trust state. */
  bypassHookTrust?: boolean;
  /** Disable Codex's native shell tool when Factory has not allowed Bash. */
  disableShellTool?: boolean;
  /** Path to a JSON Schema file for Codex's final response. */
  outputSchemaPath?: string;
  /** Additional inline `-c key=value` overrides (e.g. MCP server config). */
  inlineConfig?: ReadonlyArray<string>;
}): string[] {
  const argv: string[] = [];
  if (input.approvalPolicy != null) {
    argv.push('--ask-for-approval', input.approvalPolicy);
  }
  argv.push(
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    ...(input.bypassHookTrust ? ['--dangerously-bypass-hook-trust'] : []),
    '--skip-git-repo-check',
    '--cd',
    input.workspaceDir,
    '--model',
    input.model,
  );
  if (input.commandSandbox != null) {
    argv.push('--sandbox', input.commandSandbox);
  }
  if (input.outputSchemaPath != null) {
    argv.push('--output-schema', input.outputSchemaPath);
  }
  if (input.systemPrompt != null) {
    // `-c` is Codex's per-invocation override for `developer_instructions`. We use a
    // TOML multi-line basic string (triple-quoted) so prompts can carry raw
    // newlines without escaping; only `\` and any embedded `"""` need escape.
    argv.push(
      '-c',
      `developer_instructions="""${escapeForTomlMultilineBasic(input.systemPrompt)}"""`,
    );
  }
  if (input.effort != null) {
    argv.push('-c', `model_reasoning_effort=${tomlString(input.effort)}`);
  }
  if (input.disableShellTool === true) {
    argv.push('-c', 'features.shell_tool=false');
  }
  // Prefer explicit MCP tool calls over Codex exposing MCP tools through
  // resource handles such as `<tool>?args` URIs.
  argv.push('-c', CODEX_DEFER_MCP_TOOLS_FEATURE);
  if (input.inlineConfig != null && input.inlineConfig.length > 0) {
    argv.push(...input.inlineConfig);
  }
  argv.push(input.prompt);
  return argv;
}
