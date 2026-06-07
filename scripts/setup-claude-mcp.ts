import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const TSX_CLI_RELATIVE = 'node_modules/tsx/dist/cli.mjs';
const TSX_BIN_RELATIVE = 'node_modules/.bin/tsx';
const SERVER_SCRIPT_RELATIVE = 'core/tool-layer/mcp/server.ts';

type SettingsJson = {
  allowedMcpServers?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

function resolveRepoRoot(): string {
  return resolve(import.meta.dirname, '..');
}

function resolveFactoryToolsCommand(repoRoot: string): string[] {
  const serverScript = join(repoRoot, SERVER_SCRIPT_RELATIVE);
  const localCli = join(repoRoot, TSX_CLI_RELATIVE);
  if (existsSync(localCli)) {
    return [process.execPath, localCli, serverScript];
  }

  const localBin = join(repoRoot, TSX_BIN_RELATIVE);
  if (existsSync(localBin)) return [localBin, serverScript];

  return ['tsx', serverScript];
}

function settingsPath(): string {
  return (
    process.env.CLAUDE_SETTINGS_PATH ?? join(homedir(), '.claude', 'settings.json')
  );
}

function readSettings(path: string): SettingsJson {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as SettingsJson;
}

function writeSettings(path: string, settings: SettingsJson): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function hasServerCommand(settings: SettingsJson, command: string[]): boolean {
  const expected = JSON.stringify(command);
  const allowedMcpServers = Array.isArray(settings.allowedMcpServers)
    ? settings.allowedMcpServers
    : [];
  return allowedMcpServers.some((entry) => {
    const value = entry.serverCommand;
    return Array.isArray(value) && JSON.stringify(value) === expected;
  });
}

function main(): void {
  const repoRoot = resolveRepoRoot();
  const command = resolveFactoryToolsCommand(repoRoot);
  const path = settingsPath();
  const settings = readSettings(path);
  const allowedMcpServers = Array.isArray(settings.allowedMcpServers)
    ? settings.allowedMcpServers
    : [];

  if (hasServerCommand(settings, command)) {
    console.log(`Claude MCP allowlist already contains factory-tools in ${path}`);
    return;
  }

  settings.allowedMcpServers = [...allowedMcpServers, { serverCommand: command }];
  writeSettings(path, settings);

  console.log(`Added factory-tools MCP allowlist entry to ${path}`);
  console.log(JSON.stringify({ serverCommand: command }, null, 2));
  console.log(
    'If Claude still reports an enterprise-policy block, the org-managed Claude allowlist must permit this exact serverCommand.',
  );
}

main();
