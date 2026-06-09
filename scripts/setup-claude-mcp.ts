import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type SettingsJson = {
  allowedMcpServers?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const MCP_REMOTE_COMMAND = ['npx', 'mcp-remote', 'http://127.0.0.1:3001/mcp'];

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

function hasCommand(settings: SettingsJson, command: string[]): boolean {
  const expected = JSON.stringify(command);
  const list = Array.isArray(settings.allowedMcpServers) ? settings.allowedMcpServers : [];
  return list.some((entry) => {
    const value = entry.serverCommand;
    return Array.isArray(value) && JSON.stringify(value) === expected;
  });
}

function main(): void {
  const path = settingsPath();
  const settings = readSettings(path);

  if (hasCommand(settings, MCP_REMOTE_COMMAND)) {
    console.log(`Claude MCP allowlist already contains mcp-remote entry in ${path}`);
    return;
  }

  const existing = Array.isArray(settings.allowedMcpServers) ? settings.allowedMcpServers : [];
  // Remove any stale direct factory-tools entry (old tsx-based command).
  const filtered = existing.filter((entry) => {
    const cmd = entry.serverCommand;
    return !(Array.isArray(cmd) && cmd.some((c) => typeof c === 'string' && c.includes('mcp/server.ts')));
  });

  settings.allowedMcpServers = [...filtered, { serverCommand: MCP_REMOTE_COMMAND }];
  writeSettings(path, settings);

  console.log(`Added mcp-remote allowlist entry to ${path}`);
  console.log(JSON.stringify({ serverCommand: MCP_REMOTE_COMMAND }, null, 2));
  console.log('Set FACTORY_USE_MCP_REMOTE=1 in your environment to activate HTTP proxy mode.');
}

main();
