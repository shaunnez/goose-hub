import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { posix as pathPosix } from 'node:path';
import { discoverPackageRoots } from '../workspaces/path-normalization.js';
import type { InvestigationContext } from './investigation-context.js';

export interface RelatedSurfaceManifest {
  keyFiles: Array<{ path: string; reason?: string }>;
  packageRoots: string[];
  existingTests: string[];
  testCandidates: string[];
  evidenceSpecPath: string | null;
  checkedAbsent: string[];
  targetedTestPaths: string[];
  readFirst: string[];
  primaryTestPath: string | null;
  testMode: 'update-existing' | 'create-candidate' | 'no-test-surface';
  doNotSearchFor: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isTestPath(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path);
}

function isCodePath(path: string): boolean {
  return /\.[jt]sx?$/.test(path) && !isTestPath(path);
}

function pathExists(worktreePath: string, repoPath: string): boolean {
  return existsSync(resolve(worktreePath, repoPath));
}

function nearestPackageRoot(path: string, roots: string[]): string | null {
  const matches = roots
    .filter((root) => path === root || path.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

function siblingTestCandidates(path: string): string[] {
  if (!isCodePath(path)) return [];
  const dir = pathPosix.dirname(path);
  const extension = extname(path);
  const stem = pathPosix.basename(path, extension);
  return [
    pathPosix.join(dir, `${stem}.test${extension}`),
    pathPosix.join(dir, `${stem}.spec${extension}`),
    pathPosix.join(dir, '__tests__', `${stem}.test${extension}`),
    pathPosix.join(dir, '__tests__', `${stem}.spec${extension}`),
  ];
}

export function buildRelatedSurfaceManifest(input: {
  worktreePath: string;
  workItemNumber: number;
  investigation?: InvestigationContext;
  evidencePostEnabled: boolean;
}): RelatedSurfaceManifest | undefined {
  const keyFiles = input.investigation?.keyFiles ?? [];
  if (keyFiles.length === 0) return undefined;

  const packageRoots = discoverPackageRoots(input.worktreePath);
  const relevantPackageRoots = unique(
    keyFiles.flatMap((file) => {
      const root = nearestPackageRoot(file.path, packageRoots);
      return root == null ? [] : [root];
    }),
  );
  const testCandidatePaths = unique(keyFiles.flatMap((file) => siblingTestCandidates(file.path)));
  const existingTests = unique([
    ...keyFiles.filter((file) => isTestPath(file.path)).map((file) => file.path),
    ...testCandidatePaths.filter((path) => pathExists(input.worktreePath, path)),
  ]);
  const checkedAbsent = testCandidatePaths.filter((path) => !pathExists(input.worktreePath, path));
  const testCandidates = testCandidatePaths.filter((path) => !existingTests.includes(path));
  const touchesWeb = keyFiles.some((file) => file.path.startsWith('apps/web/'));
  const evidenceSpecPath =
    touchesWeb && input.evidencePostEnabled
      ? `apps/web/e2e/issue-${input.workItemNumber}.spec.ts`
      : null;
  const targetedTestPaths = existingTests.length > 0 ? existingTests : testCandidates.slice(0, 1);
  const primaryTestPath = targetedTestPaths[0] ?? null;
  const testMode =
    existingTests.length > 0
      ? 'update-existing'
      : primaryTestPath != null
        ? 'create-candidate'
        : 'no-test-surface';

  return {
    keyFiles,
    packageRoots: relevantPackageRoots,
    existingTests,
    testCandidates,
    evidenceSpecPath,
    checkedAbsent,
    targetedTestPaths,
    readFirst: unique([...keyFiles.map((file) => file.path), ...targetedTestPaths]),
    primaryTestPath,
    testMode,
    doNotSearchFor: checkedAbsent,
  };
}

export function discoveryCallsRepeatRelatedSurface(input: {
  toolEvents: Array<{ kind: string; payload: unknown }>;
  relatedSurface?: RelatedSurfaceManifest;
}): boolean {
  const absent = input.relatedSurface?.checkedAbsent ?? [];
  if (absent.length === 0) return false;
  const absentSet = new Set(absent);
  return input.toolEvents.some((event) => {
    if (event.kind !== 'agent.tool-call') return false;
    const payload = event.payload as Record<string, unknown>;
    const toolName = payload.tool_name ?? payload.tool;
    if (toolName !== 'list_files' && toolName !== 'search_text') return false;
    const toolInput = payload.tool_input as Record<string, unknown> | undefined;
    const path = typeof toolInput?.path === 'string' ? toolInput.path : null;
    const glob = typeof toolInput?.glob === 'string' ? toolInput.glob : null;
    if (path == null || glob == null) return false;
    return absent.some((absentPath) => {
      if (!absentPath.startsWith(`${path}/`)) return false;
      const basename = pathPosix.basename(absentPath);
      return (
        glob === basename || glob === `**/${basename}` || absentSet.has(pathPosix.join(path, glob))
      );
    });
  });
}
