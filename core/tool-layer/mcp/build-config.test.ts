import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFactoryMcpConfig } from './build-config.js';

let workspace: string;
let orchestratorRoot: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-mcp-config-'));
  orchestratorRoot = mkdtempSync(join(tmpdir(), 'factory-orch-root-'));
  // Stub a server.ts so the path resolves; we don't actually exec it.
  mkdirSync(join(orchestratorRoot, 'core/tool-layer/mcp'), { recursive: true });
  writeFileSync(join(orchestratorRoot, 'core/tool-layer/mcp/server.ts'), '// stub');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(orchestratorRoot, { recursive: true, force: true });
});

describe('buildFactoryMcpConfig', () => {
  it('writes <worktree>/.factory/mcp-config.json with the factory-tools server entry', () => {
    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-123',
      projectId: 'demo',
      workItemId: 'github:demo/repo#7',
      toolBundles: [],
      orchestratorRoot,
    });

    expect(result.configPath).toBe(join(workspace, '.factory/mcp-config.json'));
    const written = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(written.mcpServers['factory-tools']).toBeDefined();
    const entry = written.mcpServers['factory-tools'];
    expect(entry.command).toBe('tsx');
    expect(entry.args[0]).toContain('core/tool-layer/mcp/server.ts');
    expect(entry.env.FACTORY_RUN_ID).toBe('run-123');
    expect(entry.env.FACTORY_PROJECT_ID).toBe('demo');
    expect(entry.env.FACTORY_WORK_ITEM_ID).toBe('github:demo/repo#7');
    expect(entry.env.FACTORY_WORKSPACE_DIR).toBe(workspace);
    expect(entry.env.FACTORY_SERVER_PORT).toBe('3001');
  });

  it('serializes a missing workItemId as an empty string (the server validates non-empty)', () => {
    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-1',
      projectId: 'demo',
      workItemId: null,
      toolBundles: [],
      orchestratorRoot,
    });
    const env = result.config.mcpServers['factory-tools'].env;
    expect(env?.FACTORY_WORK_ITEM_ID).toBe('');
  });

  it('merges playwright-mcp entries from apps/web/.mcp.json when the bundle is declared', () => {
    mkdirSync(join(workspace, 'apps/web'), { recursive: true });
    writeFileSync(
      join(workspace, 'apps/web/.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'playwright-test': { command: 'node', args: ['playwright-mcp.js'] },
        },
      }),
    );

    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-1',
      projectId: 'demo',
      workItemId: null,
      toolBundles: ['playwright-mcp'],
      orchestratorRoot,
    });

    expect(Object.keys(result.config.mcpServers).sort()).toEqual(
      ['factory-tools', 'playwright-test'].sort(),
    );
  });

  it('silently skips bundle MCP files that do not exist', () => {
    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-1',
      projectId: 'demo',
      workItemId: null,
      toolBundles: ['playwright-mcp'],
      orchestratorRoot,
    });
    expect(Object.keys(result.config.mcpServers)).toEqual(['factory-tools']);
  });

  it('silently skips malformed bundle MCP files', () => {
    mkdirSync(join(workspace, 'apps/web'), { recursive: true });
    writeFileSync(join(workspace, 'apps/web/.mcp.json'), 'not valid json');

    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-1',
      projectId: 'demo',
      workItemId: null,
      toolBundles: ['playwright-mcp'],
      orchestratorRoot,
    });
    expect(Object.keys(result.config.mcpServers)).toEqual(['factory-tools']);
  });

  it('accepts a custom FACTORY_SERVER_PORT', () => {
    const result = buildFactoryMcpConfig({
      workspaceDir: workspace,
      runId: 'run-1',
      projectId: 'demo',
      workItemId: null,
      toolBundles: [],
      serverPort: 4099,
      orchestratorRoot,
    });
    expect(result.config.mcpServers['factory-tools'].env?.FACTORY_SERVER_PORT).toBe('4099');
  });
});
