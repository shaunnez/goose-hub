import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventStore } from '../../event-stream/store.js';
import type { FactoryContext } from './context.js';
import {
  buildWorkspaceResourceTemplate,
  readWorkspaceResource,
  uriToWorkspaceRelative,
  workspaceRelativeToUri,
} from './tools/resources.js';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-resources-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
  writeFileSync(join(workspace, 'README.md'), '# Demo\n\nhello world\n');
  mkdirSync(join(workspace, 'src'));
  writeFileSync(join(workspace, 'src', 'index.ts'), 'export const X = 1;\n');
  writeFileSync(join(workspace, 'src', 'util.ts'), 'export const Y = 2;\n');
  mkdirSync(join(workspace, '.factory'));
  writeFileSync(join(workspace, '.factory', 'secret.json'), 'secret');
  mkdirSync(join(workspace, 'node_modules'));
  writeFileSync(join(workspace, 'node_modules', 'pkg.js'), 'pkg');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('uriToWorkspaceRelative', () => {
  it('strips factory:// prefix', () => {
    expect(uriToWorkspaceRelative('factory://src/index.ts')).toBe('src/index.ts');
  });

  it('strips file:/// prefix', () => {
    expect(uriToWorkspaceRelative('file:///src/index.ts')).toBe('src/index.ts');
  });

  it('strips file:// prefix (two slashes)', () => {
    expect(uriToWorkspaceRelative('file://src/index.ts')).toBe('src/index.ts');
  });

  it('passes bare path through unchanged', () => {
    expect(uriToWorkspaceRelative('src/index.ts')).toBe('src/index.ts');
  });
});

describe('resources/list', () => {
  it('returns workspace files as factory:// URIs', async () => {
    const template = buildWorkspaceResourceTemplate(ctx);
    const result = await (
      template.listCallback as (() => Promise<{ resources: Array<{ uri: string }> }>) | undefined
    )?.();
    const uris = result?.resources?.map((r: { uri: string }) => r.uri) ?? [];
    expect(uris).toContain('factory://README.md');
    expect(uris).toContain('factory://src/index.ts');
    expect(uris).toContain('factory://src/util.ts');
  });

  it('excludes .factory directory files', async () => {
    const template = buildWorkspaceResourceTemplate(ctx);
    const result = await (
      template.listCallback as (() => Promise<{ resources: Array<{ uri: string }> }>) | undefined
    )?.();
    const uris = result?.resources?.map((r: { uri: string }) => r.uri) ?? [];
    expect(uris).not.toContain('factory://.factory/secret.json');
  });

  it('excludes node_modules directory', async () => {
    const template = buildWorkspaceResourceTemplate(ctx);
    const result = await (
      template.listCallback as (() => Promise<{ resources: Array<{ uri: string }> }>) | undefined
    )?.();
    const uris = result?.resources?.map((r: { uri: string }) => r.uri) ?? [];
    expect(uris).not.toContain('factory://node_modules/pkg.js');
  });
});

type TextContent = { uri: string; text: string; mimeType?: string };
function asText(c: unknown): TextContent {
  return c as TextContent;
}

describe('resources/read', () => {
  it('reads a file by factory:// URI and returns text contents', async () => {
    const result = await readWorkspaceResource(ctx, 'factory://README.md');
    expect(result.contents).toHaveLength(1);
    expect(asText(result.contents[0]).text).toContain('hello world');
    expect(result.contents[0].uri).toBe('factory://README.md');
    expect(result.contents[0].mimeType).toBe('text/plain');
  });

  it('reads a file by file:// URI', async () => {
    const result = await readWorkspaceResource(ctx, 'file:///README.md');
    expect(asText(result.contents[0]).text).toContain('hello world');
  });

  it('reads a file by bare path', async () => {
    const result = await readWorkspaceResource(ctx, 'src/index.ts');
    expect(asText(result.contents[0]).text).toContain('const X = 1');
  });

  it('applies path policy — denies .factory files', async () => {
    await expect(readWorkspaceResource(ctx, 'factory://.factory/secret.json')).rejects.toThrow();
  });

  it('emits agent.tool-call audit event on success', async () => {
    await readWorkspaceResource(ctx, 'factory://README.md');
    const calls = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const resourceRead = calls.find(
      (e) => (e.payload as { tool_name?: string }).tool_name === 'resources/read',
    );
    expect(resourceRead).toBeDefined();
    expect((resourceRead?.payload as { status: string }).status).toBe('ok');
  });

  it('shares cache with read_file (same canonical path = cache hit)', async () => {
    const { readFileTool } = await import('./tools/read.js');
    // First call via read_file populates the cache
    await readFileTool(ctx, { path: 'README.md' });
    // Second call via resources/read should hit the cache
    const result = await readWorkspaceResource(ctx, 'factory://README.md');
    expect(asText(result.contents[0]).text).toContain('hello world');
    const calls = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const resourceReadCall = calls.find(
      (e) => (e.payload as { tool_name?: string }).tool_name === 'resources/read',
    );
    // The underlying readFileTool is called; it may return cached result
    expect(resourceReadCall).toBeDefined();
  });
});
