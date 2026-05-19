import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

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
  | 'workspace_escape';

const DENIED_SEGMENTS: ReadonlyArray<{ segment: string; reason: PathPolicyReason }> = [
  { segment: '.codex', reason: 'assistant_home' },
  { segment: '.agents', reason: 'assistant_home' },
  { segment: '.claude', reason: 'assistant_home' },
  { segment: '.factory', reason: 'factory_internals' },
];

export interface ResolvedPath {
  absolute: string;
  relative: string;
}

/**
 * Resolves an agent-supplied path against the workspace root and rejects
 * anything that escapes the worktree or touches assistant/Factory internals.
 *
 * Inputs are workspace-relative by contract. Absolute paths, `..`, `~`, and
 * the denied segments fail with a typed `PathPolicyViolation` whose `code`
 * is suitable for the structured `agent.tool-call` audit event.
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

  const normalized = normalize(requested);
  const segments = normalized.split(/[\\/]/).filter((s) => s.length > 0);

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

  const root = resolve(workspaceRoot);
  const absolute = resolve(root, normalized);
  const rel = relative(root, absolute);

  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathPolicyViolation(
      'workspace_escape',
      requested,
      `Path resolves outside the workspace: ${requested}`,
    );
  }

  return { absolute, relative: rel.split(sep).join('/') };
}

export function isPathPolicyViolation(err: unknown): err is PathPolicyViolation {
  return err instanceof PathPolicyViolation;
}
