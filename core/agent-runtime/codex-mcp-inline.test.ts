import { describe, expect, it } from 'vitest';
import { buildCodexMcpInlineArgs, codexMcpEnabledToolsForServer } from './codex-config.js';

describe('buildCodexMcpInlineArgs', () => {
  it('emits command + args + env as -c TOML overrides for a single server', () => {
    const out = buildCodexMcpInlineArgs({
      'factory-tools': {
        command: '/abs/path/to/tsx',
        args: ['/abs/server.ts'],
        env: { FACTORY_RUN_ID: 'run-1', FACTORY_PROJECT_ID: 'demo' },
      },
    });
    expect(out).toEqual([
      '-c',
      'mcp_servers.factory-tools.command="/abs/path/to/tsx"',
      '-c',
      'mcp_servers.factory-tools.args=["/abs/server.ts"]',
      '-c',
      'mcp_servers.factory-tools.env={FACTORY_RUN_ID="run-1",FACTORY_PROJECT_ID="demo"}',
    ]);
  });

  it('omits env entirely when env is undefined or empty', () => {
    const noEnv = buildCodexMcpInlineArgs({
      svc: { command: 'node', args: ['srv.js'] },
    });
    const emptyEnv = buildCodexMcpInlineArgs({
      svc: { command: 'node', args: ['srv.js'], env: {} },
    });
    expect(noEnv.some((s) => s.includes('.env='))).toBe(false);
    expect(emptyEnv.some((s) => s.includes('.env='))).toBe(false);
  });

  it('escapes backslashes and double-quotes in string values', () => {
    const out = buildCodexMcpInlineArgs({
      svc: {
        command: 'C:\\path\\to\\tsx.exe',
        args: ['arg "with" quotes'],
        env: { FOO: 'bar\\baz' },
      },
    });
    expect(out).toContain('mcp_servers.svc.command="C:\\\\path\\\\to\\\\tsx.exe"');
    expect(out).toContain('mcp_servers.svc.args=["arg \\"with\\" quotes"]');
    expect(out).toContain('mcp_servers.svc.env={FOO="bar\\\\baz"}');
  });

  it('handles multiple servers in order', () => {
    const out = buildCodexMcpInlineArgs({
      'factory-tools': { command: 'tsx', args: ['s1.ts'] },
      'playwright-test': { command: 'node', args: ['s2.js'] },
    });
    // 2 servers x 2 directives (no env) = 4 pairs = 8 entries
    expect(out).toHaveLength(8);
    expect(out[1]).toContain('mcp_servers.factory-tools');
    expect(out[5]).toContain('mcp_servers.playwright-test');
  });

  it('produces an empty array when given no servers', () => {
    expect(buildCodexMcpInlineArgs({})).toEqual([]);
  });

  it('emits enabled_tools as server-local tool names when provided', () => {
    const out = buildCodexMcpInlineArgs({
      'factory-tools': {
        command: 'tsx',
        args: ['server.ts'],
        enabledTools: ['read_file', 'run_tests'],
      },
    });

    expect(out).toContain('mcp_servers.factory-tools.enabled_tools=["read_file","run_tests"]');
  });

  it('keeps native tools out of server-local enabled_tools derivation', () => {
    expect(
      codexMcpEnabledToolsForServer('factory-tools', [
        'mcp__factory-tools__read_file',
        'Bash',
        'mcp__playwright-test__browser_click',
      ]),
    ).toEqual(['read_file']);
  });
});
