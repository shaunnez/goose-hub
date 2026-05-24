import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventStore } from '../../event-stream/store.js';
import type { FactoryContext } from './context.js';
import { buildFactoryMcpServer } from './server.js';
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
    expect(uriToWorkspaceRelative('factory://src/index.ts')).toEqual({
      op: 'read',
      path: 'src/index.ts',
    });
  });

  it('strips file:/// prefix', () => {
    expect(uriToWorkspaceRelative('file:///src/index.ts')).toEqual({
      op: 'read',
      path: 'src/index.ts',
    });
  });

  it('strips file:// prefix (two slashes)', () => {
    expect(uriToWorkspaceRelative('file://src/index.ts')).toEqual({
      op: 'read',
      path: 'src/index.ts',
    });
  });

  it('passes bare path through unchanged', () => {
    expect(uriToWorkspaceRelative('src/index.ts')).toEqual({ op: 'read', path: 'src/index.ts' });
  });

  it('handles codex read_file?path=… URI form', () => {
    expect(uriToWorkspaceRelative('read_file?path=package.json')).toEqual({
      op: 'read',
      path: 'package.json',
    });
  });

  it('handles codex file_exists?path=… URI form', () => {
    expect(
      uriToWorkspaceRelative(
        'file_exists?path=apps/web/src/components/chat/components/ChatDock.tsx',
      ),
    ).toEqual({
      op: 'exists',
      path: 'apps/web/src/components/chat/components/ChatDock.tsx',
    });
  });

  it('url-decodes percent-encoded paths in tool-shaped URIs', () => {
    expect(uriToWorkspaceRelative('read_file?path=apps%2Fweb%2Fsrc%2Findex.ts')).toEqual({
      op: 'read',
      path: 'apps/web/src/index.ts',
    });
  });

  it('does not throw on malformed percent sequences — returns raw capture as fallback', () => {
    // %GG is not a valid percent-encoded sequence; must not throw
    expect(() => uriToWorkspaceRelative('read_file?path=foo%GGbar.ts')).not.toThrow();
    const result = uriToWorkspaceRelative('read_file?path=foo%GGbar.ts');
    expect(result.op).toBe('read');
    // fallback: raw encoded string is returned unchanged
    expect(result.path).toBe('foo%GGbar.ts');
  });

  it('captures only up to & in tool-shaped URIs (greedy-match guard)', () => {
    // extra query params must not bleed into path
    expect(uriToWorkspaceRelative('read_file?path=foo.ts&encoding=utf8')).toEqual({
      op: 'read',
      path: 'foo.ts',
    });
  });

  it('keeps bare path / factory:// / file:// forms as read', () => {
    expect(uriToWorkspaceRelative('factory://core/types.ts')).toEqual({
      op: 'read',
      path: 'core/types.ts',
    });
    expect(uriToWorkspaceRelative('file:///core/types.ts')).toEqual({
      op: 'read',
      path: 'core/types.ts',
    });
    expect(uriToWorkspaceRelative('core/types.ts')).toEqual({ op: 'read', path: 'core/types.ts' });
  });
});

describe('resource template URI matching', () => {
  it('matches nested paths via reserved-expansion {+path}', () => {
    const template = buildWorkspaceResourceTemplate(ctx);
    expect(template.uriTemplate.match('factory://src/index.ts')).toEqual({ path: 'src/index.ts' });
    expect(template.uriTemplate.match('factory://src/nested/dir/file.ts')).toEqual({
      path: 'src/nested/dir/file.ts',
    });
  });

  it('matches root-level paths too', () => {
    const template = buildWorkspaceResourceTemplate(ctx);
    expect(template.uriTemplate.match('factory://README.md')).toEqual({ path: 'README.md' });
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

  it('routes file_exists?path=… via fileExistsTool and serializes { exists: bool }', async () => {
    const result = await readWorkspaceResource(ctx, 'file_exists?path=README.md');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(asText(result.contents[0]).text)).toEqual({
      exists: true,
      path: 'README.md',
    });
  });

  it('routes file_exists for a missing path and reports exists:false (no throw)', async () => {
    const result = await readWorkspaceResource(ctx, 'file_exists?path=does-not-exist.ts');
    expect(JSON.parse(asText(result.contents[0]).text)).toMatchObject({ exists: false });
  });

  it('shares run-cache with read_file for the same canonical path', async () => {
    const { readFileTool } = await import('./tools/read.js');
    await readFileTool(ctx, { path: 'README.md' });
    const result = await readWorkspaceResource(ctx, 'read_file?path=README.md');
    // The audit event should be marked cached:true on the second read.
    const events = eventStore.replay({ workItemId: ctx.workItemId });
    type ToolCallPayload = { tool_name?: string; cached?: boolean };
    const last = [...events]
      .reverse()
      .find((e) => (e.payload as ToolCallPayload).tool_name === 'resources/read');
    expect((last?.payload as ToolCallPayload).cached).toBe(true);
    expect(asText(result.contents[0]).text).toBeDefined();
  });

  it('does not throw "Invalid URL" when called with read_file?path=… via the server transport', async () => {
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'test-pkg' }, null, 2));
    const server = buildFactoryMcpServer(ctx);
    // Access the low-level Server's _requestHandlers map to call the handler directly
    type HandlerMap = Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    const handlers = (server.server as unknown as { _requestHandlers: HandlerMap })
      ._requestHandlers;
    const handler = handlers.get('resources/read');
    expect(handler).toBeDefined();
    const response = await handler?.(
      {
        method: 'resources/read',
        params: { uri: 'read_file?path=package.json' },
      },
      {},
    );
    expect((response as { contents: Array<{ text: string }> }).contents[0].text).toContain(
      '"name"',
    );
  });
});
