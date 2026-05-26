import { describe, expect, it } from 'vitest';
import { buildCodexMcpInlineArgs } from './codex-config.js';

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
      'mcp_servers.factory-tools.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.factory-tools.env={FACTORY_RUN_ID="run-1",FACTORY_PROJECT_ID="demo"}',
    ]);
  });

  it('emits required and timeout settings when provided', () => {
    const out = buildCodexMcpInlineArgs({
      'factory-tools': {
        command: 'tsx',
        args: ['server.ts'],
        required: true,
        startupTimeoutSec: 20,
        toolTimeoutSec: 600,
      },
    });

    expect(out).toContain('mcp_servers.factory-tools.required=true');
    expect(out).toContain('mcp_servers.factory-tools.startup_timeout_sec=20');
    expect(out).toContain('mcp_servers.factory-tools.tool_timeout_sec=600');
  });

  it('pre-approves every Factory-managed MCP server so Codex does not prompt mid-run', () => {
    const out = buildCodexMcpInlineArgs({
      'factory-tools': { command: 'tsx', args: ['s1.ts'] },
      'playwright-test': { command: 'node', args: ['s2.js'] },
    });
    expect(out).toContain('mcp_servers.factory-tools.default_tools_approval_mode="approve"');
    expect(out).toContain('mcp_servers.playwright-test.default_tools_approval_mode="approve"');
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
    // 2 servers x 3 directives (command, args, approval; no env / no enabledTools) = 6 pairs = 12 entries
    expect(out).toHaveLength(12);
    expect(out[1]).toContain('mcp_servers.factory-tools');
    expect(out[7]).toContain('mcp_servers.playwright-test');
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
});
