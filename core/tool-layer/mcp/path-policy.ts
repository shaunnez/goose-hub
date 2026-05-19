import { isAbsolute, resolve } from 'node:path';
import { type RepoRelativePath, canonicalizeFactoryToolPath } from '../path-contract.js';

export class PathPolicyViolation extends Error {
  readonly kind = 'PathPolicyViolation' as const;
  readonly code: PathPolicyReason;
  readonly requestedPath: string;

  constructor(code: PathPolicyReason, requestedPath: string, message: string) {
    super(message);
    this.name = 'PathPolicyViolation';
    this.code = code;
    this.requestedPath = requestedPath;
  }
}

export type PathPolicyReason =
  | 'absolute_path'
  | 'parent_traversal'
  | 'home_expansion'
  | 'assistant_home'
  | 'factory_internals'
  | 'empty_path'
  | 'workspace_escape'
  | 'ambiguous_path';

const DENIED_SEGMENTS: ReadonlyArray<{ segment: string; reason: PathPolicyReason }> = [
  { segment: '.codex', reason: 'assistant_home' },
  { segment: '.agents', reason: 'assistant_home' },
  { segment: '.claude', reason: 'assistant_home' },
  { segment: '.factory', reason: 'factory_internals' },
];

export interface ResolvedPath {
  absolute: string;
  canonical: RepoRelativePath;
}

/**
 * Resolves an agent-supplied path against the workspace root and rejects
 * anything that escapes the worktree or touches assistant/Factory internals.
 *
 * Inputs are workspace-relative by contract. Absolute paths, `..`, `~`, and
 * the denied segments fail with a typed `PathPolicyViolation` whose `code`
 * is suitable for the structured `agent.tool-call` audit event.
 *
 * Path resolution is delegated to `canonicalizeFactoryToolPath` from
 * `path-contract.ts`, which normalizes package-relative and absolute-worktree
 * paths and returns the structured `RepoRelativePath` shape.
 */
export function resolveWorkspacePath(workspaceRoot: string, requested: string): ResolvedPath {
  if (typeof requested !== 'string' || requested.trim().length === 0) {
    throw new PathPolicyViolation('empty_path', requested, 'Path is empty.');
  }

  if (requested.startsWith('~')) {
    throw new PathPolicyViolation(
      'home_expansion',
      requested,
      `Path uses '~' home expansion: ${requested}`,
    );
  }

  if (isAbsolute(requested)) {
    throw new PathPolicyViolation(
      'absolute_path',
      requested,
      `Absolute paths are not accepted: ${requested}`,
    );
  }

  const segments = requested.split(/[\\/]/).filter((s) => s.length > 0);

  if (segments.includes('..')) {
    throw new PathPolicyViolation(
      'parent_traversal',
      requested,
      `Path contains parent traversal: ${requested}`,
    );
  }

  for (const denied of DENIED_SEGMENTS) {
    if (segments.includes(denied.segment)) {
      throw new PathPolicyViolation(
        denied.reason,
        requested,
        `Path references ${denied.segment}: ${requested}`,
      );
    }
  }

  const result = canonicalizeFactoryToolPath({
    rawPath: requested,
    worktreePath: workspaceRoot,
  });

  if (!result.ok) {
    if (result.error.kind === 'ambiguous-repo-relative-path') {
      throw new PathPolicyViolation('ambiguous_path', requested, result.error.message);
    }
    throw new PathPolicyViolation('workspace_escape', requested, result.error.message);
  }

  // Re-check denylist on the canonical path so decorators (quotes, `./`) that
  // passed the raw-segment check above cannot smuggle a denied segment through.
  const canonicalSegments = result.path.path.split('/').filter((s) => s.length > 0);
  for (const denied of DENIED_SEGMENTS) {
    if (canonicalSegments.includes(denied.segment)) {
      throw new PathPolicyViolation(
        denied.reason,
        requested,
        `Path references ${denied.segment}: ${requested}`,
      );
    }
  }

  const absolute = resolve(workspaceRoot, result.path.path);
  return { absolute, canonical: result.path };
}

export function isPathPolicyViolation(err: unknown): err is PathPolicyViolation {
  return err instanceof PathPolicyViolation;
}
