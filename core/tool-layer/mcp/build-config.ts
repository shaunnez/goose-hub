import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
  /** Bundle names declared on the skill spec; used to merge bundle-specific MCP servers. */
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

const BUNDLE_TO_MCP_RELATIVE: Record<string, string> = {
  'playwright-mcp': 'apps/web/.mcp.json',
};

/**
 * Builds and writes the per-run MCP config that Claude/Codex CLIs pass via
 * `--mcp-config`. Always includes the `factory-tools` server entry, with
 * the run-scoped identity propagated via env vars (the agent never sees
 * these — it gets the MCP tools from the spawned server).
 *
 * Bundle-specific servers (today: `playwright-mcp`) are merged in from
 * their workspace-relative config files when those bundles are declared.
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
      ...resolveBundleServers(input.toolBundles, workspaceDir),
    },
  };

  const configPath = join(workspaceDir, PER_RUN_CONFIG_RELATIVE);
  mkdirSync(dirname(configPath), { recursive: true });
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

function resolveBundleServers(
  toolBundles: ReadonlyArray<string>,
  workspaceDir: string,
): Record<string, McpServerEntry> {
  const merged: Record<string, McpServerEntry> = {};
  for (const bundle of toolBundles) {
    const relPath = BUNDLE_TO_MCP_RELATIVE[bundle];
    if (relPath == null) continue;
    const candidate = isAbsolute(relPath) ? relPath : join(workspaceDir, relPath);
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<McpConfigJson>;
      const servers = parsed.mcpServers ?? {};
      for (const [name, entry] of Object.entries(servers)) {
        merged[name] = entry as McpServerEntry;
      }
    } catch {
      // Malformed bundle MCP config — skip silently rather than aborting
      // the run; factory-tools will still be available, which is what the
      // agent actually needs.
    }
  }
  return merged;
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
