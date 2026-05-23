import { posix as pathPosix } from 'node:path';
import { eventStore } from '../event-stream/store.js';
import {
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '../workspaces/path-normalization.js';

export interface InvestigationContext {
  findings?: string;
  keyFiles: Array<{
    path: string;
    reason?: string;
    line?: number;
    symbol?: string;
    snippet?: string;
  }>;
  openQuestions: string[];
  fixHint?: {
    file: string;
    line: number;
    currentCode: string;
    suggestedApproach: string;
  };
  investigationRunId?: string;
}

function normalizeKeyFile(
  raw: unknown,
): { path: string; reason?: string; line?: number; symbol?: string; snippet?: string } | null {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { path: raw.trim() };
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.path !== 'string' || record.path.trim().length === 0) return null;
  return {
    path: record.path.trim(),
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    line:
      typeof record.line === 'number' && Number.isInteger(record.line) && record.line >= 1
        ? record.line
        : undefined,
    symbol: typeof record.symbol === 'string' ? record.symbol : undefined,
    snippet: typeof record.snippet === 'string' ? record.snippet.slice(0, 800) : undefined,
  };
}

function normalizeFixHint(raw: unknown):
  | {
      file: string;
      line: number;
      currentCode: string;
      suggestedApproach: string;
    }
  | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.file !== 'string' ||
    record.file.trim().length === 0 ||
    typeof record.line !== 'number' ||
    !Number.isInteger(record.line) ||
    record.line < 1 ||
    typeof record.currentCode !== 'string' ||
    typeof record.suggestedApproach !== 'string'
  ) {
    return undefined;
  }
  return {
    file: record.file.trim(),
    line: record.line,
    currentCode: record.currentCode.slice(0, 1200),
    suggestedApproach: record.suggestedApproach,
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
          fixHint?: unknown;
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
  const fixHint = normalizeFixHint(investigation.fixHint);

  if (
    (findings == null || findings.length === 0) &&
    keyFiles.length === 0 &&
    openQuestions.length === 0 &&
    fixHint == null
  ) {
    return undefined;
  }

  return {
    findings,
    keyFiles,
    openQuestions,
    fixHint:
      fixHint == null || worktreePath == null
        ? fixHint
        : {
            ...fixHint,
            file: normalizeRepoRelativePath({
              rawPath: fixHint.file,
              worktreePath,
              packageRoots,
              referencePaths: [...rawKeyFiles.map((f) => f.path), fixHint.file],
            }).path,
          },
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
