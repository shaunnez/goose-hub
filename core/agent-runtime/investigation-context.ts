import { posix as pathPosix } from 'node:path';
import { eventStore } from '../event-stream/store.js';
import {
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '../workspaces/path-normalization.js';

export interface InvestigationContext {
  findings?: string;
  keyFiles: Array<{ path: string; reason?: string }>;
  openQuestions: string[];
  investigationRunId?: string;
}

function normalizeKeyFile(raw: unknown): { path: string; reason?: string } | null {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { path: raw.trim() };
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.path !== 'string' || record.path.trim().length === 0) return null;
  return {
    path: record.path.trim(),
    reason: typeof record.reason === 'string' ? record.reason : undefined,
  };
}

export function latestInvestigationContext(input: {
  projectId: string;
  workItemId: string;
  worktreePath?: string;
}): InvestigationContext | undefined {
  const latest = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.investigation-complete',
    order: 'desc',
    limit: 1,
  })[0];
  if (latest == null) return undefined;

  const payload = latest.payload as
    | {
        investigate?: {
          findings?: unknown;
          keyFiles?: unknown;
          openQuestions?: unknown;
        };
        investigationRunId?: unknown;
      }
    | undefined;
  const investigation = payload?.investigate;
  if (investigation == null) return undefined;

  const rawKeyFiles = Array.isArray(investigation.keyFiles)
    ? investigation.keyFiles.map(normalizeKeyFile).filter((f) => f != null)
    : [];
  const worktreePath = input.worktreePath;
  const packageRoots = worktreePath == null ? undefined : discoverPackageRoots(worktreePath);
  const keyFiles =
    worktreePath == null
      ? rawKeyFiles
      : rawKeyFiles.map((file) => ({
          ...file,
          path: normalizeRepoRelativePath({
            rawPath: file.path,
            worktreePath,
            packageRoots,
            referencePaths: rawKeyFiles.map((f) => f.path),
          }).path,
        }));
  const openQuestions = Array.isArray(investigation.openQuestions)
    ? investigation.openQuestions.filter((q): q is string => typeof q === 'string')
    : [];
  const findings = typeof investigation.findings === 'string' ? investigation.findings : undefined;

  if (
    (findings == null || findings.length === 0) &&
    keyFiles.length === 0 &&
    openQuestions.length === 0
  ) {
    return undefined;
  }

  return {
    findings,
    keyFiles,
    openQuestions,
    investigationRunId:
      typeof payload?.investigationRunId === 'string'
        ? payload.investigationRunId
        : (latest.runId ?? undefined),
  };
}

function pathStem(path: string): string {
  return pathPosix
    .basename(path)
    .replace(/\.(test|spec)\.[^.]+$/, '')
    .replace(/\.[^.]+$/, '');
}

function sameInvestigationSurface(touchedPath: string, keyFile: string): boolean {
  if (touchedPath === keyFile) return true;
  if (pathPosix.dirname(touchedPath) !== pathPosix.dirname(keyFile)) return false;
  const touchedStem = pathStem(touchedPath);
  const keyStem = pathStem(keyFile);
  return touchedStem === keyStem || touchedStem.startsWith(`${keyStem}.`);
}

export function pathsTouchInvestigationSurface(
  touchedPaths: string[],
  investigation: InvestigationContext | undefined,
): boolean {
  const keyFiles = investigation?.keyFiles.map((f) => f.path).filter((p) => p.length > 0) ?? [];
  if (keyFiles.length === 0) return true;
  return touchedPaths.some((touched) =>
    keyFiles.some((keyFile) => sameInvestigationSurface(touched, keyFile)),
  );
}

export function toolCallsTouchInvestigationSurface(input: {
  events: Array<{ kind: string; payload: unknown }>;
  investigation?: InvestigationContext;
}): boolean {
  const keyFiles =
    input.investigation?.keyFiles.map((f) => f.path).filter((p) => p.length > 0) ?? [];
  if (keyFiles.length === 0) return true;
  const toolEvents = input.events.filter((e) => e.kind === 'agent.tool-call');
  if (toolEvents.length === 0) return true;
  const payloadText = JSON.stringify(toolEvents.map((e) => e.payload)).toLowerCase();
  return keyFiles.some((keyFile) => {
    const normalized = keyFile.toLowerCase();
    return payloadText.includes(normalized) || payloadText.includes(pathPosix.basename(normalized));
  });
}
