import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// SERVER_SCRIPT_RELATIVE is the path relative to the orchestrator root.
// Static so it survives `vi.mock('node:fs')` in agent-runtime tests.

const SERVER_SCRIPT_RELATIVE = 'core/tool-layer/mcp/server.ts';
const TSX_BIN_RELATIVE = 'node_modules/.bin/tsx';
const TSX_CLI_RELATIVE = 'node_modules/tsx/dist/cli.mjs';

const PER_RUN_CONFIG_RELATIVE = '.factory/mcp-config.json';

const DEFAULT_FACTORY_SERVER_PORT = '3001';

export interface BuildFactoryMcpConfigInput {
  workspaceDir: string;
  runId: string;
  projectId: string;
  workItemId: string | null;
  /** Skill name for timeline attribution of tool-originated events. */
  skill?: string | null;
  personaId?: string | null;
  /** Bundle names declared on the skill spec. Kept for caller parity; factory-tools is always used. */
  toolBundles: ReadonlyArray<string>;
  /** Optional orchestrator HTTP port to expose via FACTORY_SERVER_PORT. */
  serverPort?: number | string;
  /** Override the inferred goose-hub repo root (the path containing `core/`). */
  orchestratorRoot?: string;
}

export interface BuildFactoryMcpConfigResult {
  /** Absolute path to the written per-run MCP config. */
  configPath: string;
  /** The config object that was serialized — useful for testing. */
  config: McpConfigJson;
}

interface McpServerEntry {
  command: string;
  args: ReadonlyArray<string>;
  env?: Record<string, string>;
}

export interface McpConfigJson {
  mcpServers: Record<string, McpServerEntry>;
}

/**
 * Builds and writes the per-run MCP config that Claude/Codex CLIs pass via
 * `--mcp-config`. Always includes the `factory-tools` server entry, with
 * the run-scoped identity propagated via env vars (the agent never sees
 * these — it gets the MCP tools from the spawned server).
 *
 * The config file lives at `<workspaceDir>/.factory/mcp-config.json` so
 * each worktree owns its own config — that removes the race between
 * concurrent runs that the old singleton `~/.factory/mcp-config.json`
 * had. `.factory` is in the path policy denylist so the agent cannot
 * read its own env contract through `factory_read_file`.
 */
export function buildFactoryMcpConfig(
  input: BuildFactoryMcpConfigInput,
): BuildFactoryMcpConfigResult {
  const workspaceDir = resolve(input.workspaceDir);
  const orchestratorRoot = input.orchestratorRoot ?? inferOrchestratorRoot();
  const serverScript = join(orchestratorRoot, SERVER_SCRIPT_RELATIVE);
  const launcher = resolveTsxLauncher(orchestratorRoot);

  const env: Record<string, string> = {
    FACTORY_RUN_ID: input.runId,
    FACTORY_PROJECT_ID: input.projectId,
    FACTORY_WORK_ITEM_ID: input.workItemId ?? '',
    FACTORY_SKILL: input.skill ?? '',
    FACTORY_PERSONA_ID: input.personaId ?? '',
    FACTORY_WORKSPACE_DIR: workspaceDir,
    FACTORY_SERVER_PORT: String(input.serverPort ?? DEFAULT_FACTORY_SERVER_PORT),
    HOME: process.env.HOME ?? homedir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    USER: process.env.USER ?? '',
    PATH:
      process.env.PATH ??
      (process.platform === 'darwin'
        ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
        : '/usr/local/bin:/usr/bin:/bin'),
  };

  const config: McpConfigJson = {
    mcpServers: {
      'factory-tools': {
        command: launcher.command,
        args: [...launcher.argsPrefix, serverScript],
        env,
      },
    },
  };

  const configPath = join(workspaceDir, PER_RUN_CONFIG_RELATIVE);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'w' });

  return { configPath, config };
}

export interface BuildMcpRemoteConfigInput {
  workspaceDir: string;
  runId: string;
  projectId: string;
  workItemId: string | null;
  skill?: string | null;
  personaId?: string | null;
  port: number;
}

/**
 * Builds a per-run MCP config that routes through `mcp-remote` (org-approved)
 * rather than spawning the tsx server directly. Claude CLI uses this when
 * the org enterprise policy blocks the direct server command.
 *
 * The sidecar env (run identity) is written to `.factory/mcp-sidecar.env.json`
 * so the HTTP sidecar process can load its run identity on startup.
 */
export function buildMcpRemoteConfig(
  input: BuildMcpRemoteConfigInput,
): BuildFactoryMcpConfigResult {
  const workspaceDir = resolve(input.workspaceDir);
  const port = input.port;

  const sidecarEnv: Record<string, string> = {
    FACTORY_RUN_ID: input.runId,
    FACTORY_PROJECT_ID: input.projectId,
    FACTORY_WORK_ITEM_ID: input.workItemId ?? '',
    FACTORY_SKILL: input.skill ?? '',
    FACTORY_PERSONA_ID: input.personaId ?? '',
    FACTORY_WORKSPACE_DIR: workspaceDir,
    FACTORY_SERVER_PORT: String(port),
    FACTORY_MCP_TRANSPORT: 'http',
    HOME: process.env.HOME ?? homedir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    USER: process.env.USER ?? '',
    PATH:
      process.env.PATH ??
      (process.platform === 'darwin'
        ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
        : '/usr/local/bin:/usr/bin:/bin'),
  };

  const envPath = join(workspaceDir, '.factory/mcp-sidecar.env.json');
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${JSON.stringify(sidecarEnv, null, 2)}\n`, { flag: 'w' });

  const config: McpConfigJson = {
    mcpServers: {
      'factory-tools': {
        command: 'npx',
        args: ['mcp-remote', `http://127.0.0.1:${port}/mcp`],
      },
    },
  };

  const configPath = join(workspaceDir, PER_RUN_CONFIG_RELATIVE);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'w' });

  return { configPath, config };
}

/**
 * Resolves the absolute path to `tsx`. The Claude/Codex CLIs spawn this
 * MCP server with the orchestrator's minimal env (PATH = /usr/local/bin:
 * /usr/bin:/bin on Linux), which doesn't include `node_modules/.bin`. Using
 * an absolute path guarantees the spawn succeeds regardless of the
 * subprocess PATH.
 *
 * Falls back to the bare command `tsx` only when the local install isn't
 * present (e.g. a globally-installed dev shell) so the helper stays usable
 * in environments where the repo wasn't installed.
 */
function resolveTsxLauncher(orchestratorRoot: string): { command: string; argsPrefix: string[] } {
  const localCli = join(orchestratorRoot, TSX_CLI_RELATIVE);
  if (existsSync(localCli)) {
    return { command: process.execPath, argsPrefix: [localCli] };
  }

  return { command: resolveTsxBinary(orchestratorRoot), argsPrefix: [] };
}

function resolveTsxBinary(orchestratorRoot: string): string {
  const local = join(orchestratorRoot, TSX_BIN_RELATIVE);
  if (existsSync(local)) return local;
  return 'tsx';
}

/**
 * The orchestrator root is computed statically from this module's path.
 * `build-config.ts` lives at `core/tool-layer/mcp/build-config.ts`, so the
 * repo root is four directories up. Static computation rather than an
 * `existsSync`-walk so the helper works under tests that mock `node:fs`.
 * Tests may pass `orchestratorRoot` directly to bypass this.
 */
function inferOrchestratorRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // core/tool-layer/mcp -> core/tool-layer -> core -> <repo root>
  return resolve(thisDir, '..', '..', '..');
}
