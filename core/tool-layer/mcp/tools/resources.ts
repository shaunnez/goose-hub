import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import { readFileTool } from './read.js';

export { ResourceTemplate };

const FACTORY_URI_PREFIX = 'factory://';

/**
 * Normalise an incoming URI/path to a workspace-relative path string.
 * Accepts:
 *   factory://<worktree-relative>   → strip prefix
 *   file:///<path>                  → strip file:// prefix
 *   bare path                       → use as-is
 */
export function uriToWorkspaceRelative(uri: string): string {
  if (uri.startsWith(FACTORY_URI_PREFIX)) return uri.slice(FACTORY_URI_PREFIX.length);
  // file:// forms: strip the scheme but keep the path
  const fileMatch = /^file:\/\/\/?(.*)$/.exec(uri);
  if (fileMatch) return fileMatch[1];
  return uri;
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
 * Read a workspace file by URI, routing through the read_file pipeline
 * (same per-run cache key, secret redaction, path policy, redundancy check).
 */
export async function readWorkspaceResource(
  ctx: FactoryContext,
  uri: URL | string,
): Promise<ReadResourceResult> {
  const uriStr = typeof uri === 'string' ? uri : uri.toString();
  const relativePath = uriToWorkspaceRelative(uriStr);
  const auditBase = { tool_name: 'resources/read', uri: uriStr, relativePath };

  try {
    const result = await readFileTool(ctx, { path: relativePath });
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.tool-call',
      payload: {
        ...auditBase,
        status: 'ok',
        cached: (result as { cached?: boolean }).cached ?? false,
      },
    });
    const canonicalUri = workspaceRelativeToUri(result.path?.path ?? relativePath);
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
