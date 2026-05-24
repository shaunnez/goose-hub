import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import { fileExistsTool, readFileTool } from './read.js';

export { ResourceTemplate };

const FACTORY_URI_PREFIX = 'factory://';
const TOOL_URI_RE = /^(read_file|file_exists)\?path=([^&]+)/;

export type ResourceOp = { op: 'read'; path: string } | { op: 'exists'; path: string };

/**
 * Normalise an incoming URI/path to a workspace-relative path with operation tag.
 * Accepts:
 *   read_file?path=<path>           → {op: 'read', path}
 *   file_exists?path=<path>         → {op: 'exists', path}
 *   factory://<worktree-relative>   → {op: 'read', path}
 *   file:///<path>                  → {op: 'read', path}
 *   bare path                       → {op: 'read', path}
 */
export function uriToWorkspaceRelative(uri: string): ResourceOp {
  const toolMatch = TOOL_URI_RE.exec(uri);
  if (toolMatch != null) {
    const op = toolMatch[1] === 'file_exists' ? 'exists' : 'read';
    let path: string;
    try {
      path = decodeURIComponent(toolMatch[2]);
    } catch {
      // Malformed percent sequence — fall back to raw capture
      path = toolMatch[2];
    }
    return { op, path };
  }
  if (uri.startsWith(FACTORY_URI_PREFIX)) {
    return { op: 'read', path: uri.slice(FACTORY_URI_PREFIX.length) };
  }
  // file:// forms: strip the scheme but keep the path
  const fileMatch = /^file:\/\/\/?(.*)$/.exec(uri);
  if (fileMatch) {
    return { op: 'read', path: fileMatch[1] };
  }
  return { op: 'read', path: uri };
}

export function workspaceRelativeToUri(relativePath: string): string {
  return `${FACTORY_URI_PREFIX}${relativePath}`;
}

export interface WorkspaceResource {
  uri: string;
  name: string;
  mimeType: string;
}

const LIST_RESOURCES_CAP = 500;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.factory', 'dist', 'build', '.pnpm']);

function collectWorkspaceResources(ctx: FactoryContext): WorkspaceResource[] {
  const resources: WorkspaceResource[] = [];

  function walk(relativeDir: string): void {
    if (resources.length >= LIST_RESOURCES_CAP) return;
    const absDir = relativeDir === '' ? ctx.workspaceRoot : join(ctx.workspaceRoot, relativeDir);
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (resources.length >= LIST_RESOURCES_CAP) break;
      const rel = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(dirent.name)) continue;
        walk(rel);
      } else if (dirent.isFile()) {
        try {
          resolveWorkspacePath(ctx.workspaceRoot, rel);
        } catch (err) {
          if (err instanceof PathPolicyViolation) continue;
          continue;
        }
        resources.push({ uri: workspaceRelativeToUri(rel), name: rel, mimeType: 'text/plain' });
      }
    }
  }

  walk('');
  return resources;
}

/**
 * Build the ResourceTemplate that powers resources/list and resources/read.
 * Registered once in server.ts. The list callback enumerates workspace files;
 * the read callback delegates to the read_file tool pipeline so redundancy
 * telemetry, path policy, and the run-cache all apply.
 */
export function buildWorkspaceResourceTemplate(ctx: FactoryContext): ResourceTemplate {
  return new ResourceTemplate(`${FACTORY_URI_PREFIX}{+path}`, {
    list: () => {
      const resources = collectWorkspaceResources(ctx);
      return Promise.resolve({ resources });
    },
  });
}

/**
 * Read a workspace file by URI, routing through the read_file or file_exists pipeline
 * (same per-run cache key, secret redaction, path policy, redundancy check).
 */
export async function readWorkspaceResource(
  ctx: FactoryContext,
  uri: URL | string,
): Promise<ReadResourceResult> {
  const uriStr = typeof uri === 'string' ? uri : uri.toString();
  const auditBase = { tool_name: 'resources/read', uri: uriStr };

  try {
    const parsed = uriToWorkspaceRelative(uriStr);
    Object.assign(auditBase, { relativePath: parsed.path, op: parsed.op });
    if (parsed.op === 'exists') {
      const result = await fileExistsTool(ctx, { path: parsed.path });
      eventStore.appendEvent({
        projectId: ctx.projectId,
        workItemId: ctx.workItemId,
        runId: ctx.runId,
        personaId: ctx.personaId ?? null,
        kind: 'agent.tool-call',
        payload: { ...auditBase, status: 'ok' },
      });
      return {
        contents: [{
          uri: workspaceRelativeToUri(result.path.path),
          mimeType: 'application/json',
          text: JSON.stringify({ exists: result.exists, path: result.path.path }),
        }],
      } satisfies ReadResourceResult;
    }
    const result = await readFileTool(ctx, { path: parsed.path });
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.tool-call',
      payload: {
        ...auditBase,
        status: 'ok',
        cached: result.cached ?? false,
      },
    });
    const canonicalUri = workspaceRelativeToUri(result.path?.path ?? parsed.path);
    return {
      contents: [{ uri: canonicalUri, mimeType: 'text/plain', text: result.content }],
    } satisfies ReadResourceResult;
  } catch (err) {
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.tool-call',
      payload: {
        ...auditBase,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
