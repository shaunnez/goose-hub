import { isAbsolute, relative, resolve } from 'node:path';

export interface WorkspaceBoundaryInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  workspaceDir?: string;
  allowedSecondaryWorkspaces?: string[];
}

export interface WorkspaceBoundaryDecision {
  allowed: boolean;
  reason?: string;
}

const PATH_SCOPED_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const ABSOLUTE_USER_PATH_RE = /\/Users\/[^\s'"`]+/g;

export function evaluateWorkspaceBoundary(
  input: WorkspaceBoundaryInput,
): WorkspaceBoundaryDecision {
  const roots = normalizeRoots([input.workspaceDir, ...(input.allowedSecondaryWorkspaces ?? [])]);
  if (roots.length === 0) return { allowed: true };

  if (PATH_SCOPED_TOOLS.has(input.toolName)) {
    const requestedPath = extractRequestedPath(input.toolInput);
    if (requestedPath == null) return { allowed: true };
    const normalized = isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(roots[0] as string, requestedPath);
    if (!isUnderAnyRoot(normalized, roots)) {
      return {
        allowed: false,
        reason: `Tool '${input.toolName}' path escapes workspace: ${requestedPath}`,
      };
    }
  }

  if (input.toolName === 'Bash') {
    const command = extractCommand(input.toolInput);
    if (command == null) return { allowed: true };
    for (const absolutePath of command.match(ABSOLUTE_USER_PATH_RE) ?? []) {
      const normalized = resolve(absolutePath);
      if (!isUnderAnyRoot(normalized, roots)) {
        return {
          allowed: false,
          reason: `Bash command references path outside workspace: ${absolutePath}`,
        };
      }
    }
  }

  return { allowed: true };
}

function normalizeRoots(paths: Array<string | undefined>): string[] {
  return paths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path) => resolve(path));
}

function extractRequestedPath(input: Record<string, unknown>): string | null {
  const value = input.file_path ?? input.path ?? input.cwd;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function extractCommand(input: Record<string, unknown>): string | null {
  const value = input.command ?? input.cmd;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isUnderAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, target);
    return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
  });
}
