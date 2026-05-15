import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
  /** Optional Codex CLI sandbox mode for model-generated shell commands. */
  commandSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Optional global approval policy. Must be placed before the `exec` subcommand. */
  approvalPolicy?: 'never';
}): string[] {
  const argv: string[] = [];
  if (input.approvalPolicy != null) {
    argv.push('--ask-for-approval', input.approvalPolicy);
  }
  argv.push(
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--cd',
    input.workspaceDir,
    '--model',
    input.model,
  );
  if (input.commandSandbox != null) {
    argv.push('--sandbox', input.commandSandbox);
  }
  if (input.systemPrompt != null) {
    // `-c` is Codex's per-invocation override for `instructions`. We use a
    // TOML multi-line basic string (triple-quoted) so prompts can carry raw
    // newlines without escaping; only `\` and any embedded `"""` need escape.
    argv.push('-c', `instructions="""${escapeForTomlMultilineBasic(input.systemPrompt)}"""`);
  }
  argv.push(input.prompt);
  return argv;
}
