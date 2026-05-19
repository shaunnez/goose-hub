import { isAbsolute, relative, resolve } from 'node:path';
import { posix as pathPosix } from 'node:path';
import { type RepoRelativePath, canonicalizeFactoryToolPath } from './path-contract.js';

export interface ToolCallAuditPayload {
  [key: string]: unknown;
  tool_name?: string;
  run_id?: string;
  tool_input?: unknown;
  workspace_dir?: unknown;
  workspaceDir?: unknown;
}

const ABSOLUTE_USER_PATH_RE = /\/Users\/[^\s'"`]+/g;
const TRANSIENT_WORKSPACE_KEYS = new Set(['workspace_dir', 'workspaceDir']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedWorkspaceDir(payload: ToolCallAuditPayload): string | null {
  const value = payload.workspace_dir ?? payload.workspaceDir;
  return typeof value === 'string' && value.trim().length > 0 ? resolve(value) : null;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function isUnderRoot(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
}

function workspaceRelativePath(path: string, workspaceDir: string): string | null {
  if (!isAbsolute(path) || !isUnderRoot(path, workspaceDir)) return null;
  const rel = toPosixPath(relative(resolve(workspaceDir), resolve(path)));
  if (rel.length === 0 || rel === '..' || rel.startsWith('../')) return null;
  return rel;
}

function redactAbsolutePath(path: string, workspaceDir: string | null): string {
  if (workspaceDir != null) {
    const rel = workspaceRelativePath(path, workspaceDir);
    if (rel != null) return `<worktree>/${rel}`;
  }
  return path.startsWith('/Users/') ? '[REDACTED_PATH]' : path;
}

function sanitizeString(value: string, workspaceDir: string | null): string {
  let sanitized = value;
  if (workspaceDir != null) {
    const rel = workspaceRelativePath(sanitized, workspaceDir);
    if (rel != null) return `<worktree>/${rel}`;

    const workspacePrefix = toPosixPath(resolve(workspaceDir));
    sanitized = sanitized.split(workspacePrefix).join('<worktree>');
  }

  return sanitized.replace(ABSOLUTE_USER_PATH_RE, (match) =>
    redactAbsolutePath(match, workspaceDir),
  );
}

function sanitizeValue(value: unknown, workspaceDir: string | null): unknown {
  if (typeof value === 'string') return sanitizeString(value, workspaceDir);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, workspaceDir));
  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (TRANSIENT_WORKSPACE_KEYS.has(key)) continue;
    sanitized[key] = sanitizeValue(child, workspaceDir);
  }
  return sanitized;
}

function rawPathFromToolInput(toolInput: unknown): string | null {
  if (!isRecord(toolInput)) return null;
  const rawPath = toolInput.file_path ?? toolInput.path ?? toolInput.cwd;
  return typeof rawPath === 'string' && rawPath.trim().length > 0 ? rawPath : null;
}

function sanitizeRepoRelativePath(
  path: RepoRelativePath,
  workspaceDir: string | null,
): RepoRelativePath {
  return {
    ...path,
    ...(path.normalizedFrom != null && {
      normalizedFrom: sanitizeString(path.normalizedFrom, workspaceDir),
    }),
  };
}

function canonicalPathMetadata(input: {
  rawPath: string;
  workspaceDir: string;
}): { raw_path: string; canonical_path: RepoRelativePath } | null {
  const canonical = canonicalizeFactoryToolPath({
    rawPath: input.rawPath,
    worktreePath: input.workspaceDir,
  });
  if (!canonical.ok) return null;

  return {
    raw_path: sanitizeString(input.rawPath, input.workspaceDir),
    canonical_path: sanitizeRepoRelativePath(canonical.path, input.workspaceDir),
  };
}

function normalizedAuditPayload(payload: ToolCallAuditPayload): Record<string, unknown> {
  const workspaceDir = normalizedWorkspaceDir(payload);
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (TRANSIENT_WORKSPACE_KEYS.has(key)) continue;
    normalized[key] = sanitizeValue(value, workspaceDir);
  }

  const rawPath = rawPathFromToolInput(payload.tool_input);
  if (rawPath != null && workspaceDir != null) {
    const metadata = canonicalPathMetadata({ rawPath, workspaceDir });
    if (metadata != null) {
      normalized.raw_path = metadata.raw_path;
      normalized.canonical_path = metadata.canonical_path;
    }
  }

  return normalized;
}

export function normalizeToolCallAuditPayload(
  payload: ToolCallAuditPayload,
): Record<string, unknown> {
  return normalizedAuditPayload(payload);
}

export function normalizeToolResultAuditPayload(
  payload: ToolCallAuditPayload,
): Record<string, unknown> {
  return normalizedAuditPayload(payload);
}

export function canonicalPathStringFromAuditPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const canonical = payload.canonical_path;
  if (!isRecord(canonical)) return null;
  const path = canonical.path;
  return typeof path === 'string' && !pathPosix.isAbsolute(path) ? path : null;
}
