import { z } from 'zod';
import { eventStore } from '../event-stream/store.js';
import { type SymbolHint, lookupWorkItemSymbols } from '../symbol-index/lookup.js';
import type { RepoRelativePath } from '../tool-layer/path-contract.js';
import { type RecentChangedFile, gitRecentChanges } from './git-intel.js';
import { buildRelatedSurfaceManifest } from './related-surface.js';

export const RepoRelativePathSchema = z.object({
  path: z.string(),
  root: z.literal('worktree'),
  packageRoot: z.string().optional(),
  normalizedFrom: z.string().optional(),
});

export const InvestigationSeedSchema = z.object({
  candidateFiles: z.array(RepoRelativePathSchema).max(25),
  candidateSymbols: z
    .array(
      z.object({
        name: z.string(),
        definedIn: z.string(),
        line: z.number(),
        kind: z.string(),
        callers: z.array(z.string()),
      }),
    )
    .max(20),
  testFiles: z.array(RepoRelativePathSchema).max(15),
  recentlyChangedFiles: z
    .array(
      z.object({
        path: RepoRelativePathSchema,
        lastTouched: z.string(),
        lastCommitSha: z.string(),
      }),
    )
    .max(15),
  priorInvestigationRunIds: z.array(z.string()).max(5),
  builtAt: z.string(),
});

export type InvestigationSeed = z.infer<typeof InvestigationSeedSchema>;

export async function buildInvestigationSeed(
  workItem: { title: string; body: string; externalId?: string | number; id?: string },
  project: { id?: string; worktreePath: string },
  deps: {
    lookupSymbols?: typeof lookupWorkItemSymbols;
    symbolIndexHints?: SymbolHint[];
    recentChanges?: typeof gitRecentChanges;
    priorInvestigationIds?: typeof findPriorInvestigationRunIds;
    now?: () => Date;
  } = {},
): Promise<InvestigationSeed> {
  const lookupSymbols = deps.lookupSymbols ?? lookupWorkItemSymbols;
  const recentChanges = deps.recentChanges ?? gitRecentChanges;
  const priorInvestigationIds = deps.priorInvestigationIds ?? findPriorInvestigationRunIds;
  const candidateSymbols = (
    deps.symbolIndexHints ??
    lookupSymbols(workItem.title, workItem.body, {
      worktreePath: project.worktreePath,
    })
  ).slice(0, 20);

  const candidateFiles = toRepoPaths(
    unique([
      ...candidateSymbols.map((symbol) => symbol.definedIn),
      ...candidateSymbols.flatMap((symbol) => symbol.callers),
    ]),
  ).slice(0, 25);

  const manifest = buildRelatedSurfaceManifest({
    worktreePath: project.worktreePath,
    workItemNumber: Number(workItem.externalId ?? 0),
    evidencePostEnabled: false,
    investigation: {
      findings: '',
      keyFiles: candidateFiles.map((file) => ({ path: file.path })),
      openQuestions: [],
    },
  });

  const testFiles = toRepoPaths(
    unique([...(manifest?.existingTests ?? []), ...(manifest?.targetedTestPaths ?? [])]),
  ).slice(0, 15);
  const recentlyChangedFiles = await recentChanges({
    worktreePath: project.worktreePath,
    candidateFiles,
    limit: 15,
  });
  const priorInvestigationRunIds = priorInvestigationIds({
    projectId: project.id,
    candidateFiles,
  });

  return {
    candidateFiles,
    candidateSymbols,
    testFiles,
    recentlyChangedFiles,
    priorInvestigationRunIds,
    builtAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
}

export function emitInvestigationSeedBuilt(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string | null;
  seed: InvestigationSeed;
  builtMs: number;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    personaId: input.personaId ?? null,
    kind: 'agent.investigation-seed-built',
    payload: {
      candidateFileCount: input.seed.candidateFiles.length,
      candidateSymbolCount: input.seed.candidateSymbols.length,
      recentlyChangedCount: input.seed.recentlyChangedFiles.length,
      priorInvestigationCount: input.seed.priorInvestigationRunIds.length,
      builtMs: input.builtMs,
    },
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function toRepoPaths(paths: string[]): RepoRelativePath[] {
  return paths.map((path) => ({ path, root: 'worktree' as const }));
}

function findPriorInvestigationRunIds(input: {
  projectId?: string;
  candidateFiles: RepoRelativePath[];
}): string[] {
  if (input.projectId == null || input.candidateFiles.length === 0) return [];
  const candidateSet = new Set(input.candidateFiles.map((file) => file.path));
  const events = eventStore.replay({
    projectId: input.projectId,
    kind: 'agent.investigation-complete',
    order: 'desc',
    limit: 100,
  });

  const runIds: string[] = [];
  for (const event of events) {
    const payload = event.payload as {
      investigationRunId?: unknown;
      investigate?: { keyFiles?: Array<{ path?: unknown }> };
    };
    const keyFiles = payload.investigate?.keyFiles ?? [];
    const overlaps = keyFiles.some(
      (file) => typeof file.path === 'string' && candidateSet.has(file.path),
    );
    const investigationRunId =
      typeof payload.investigationRunId === 'string' ? payload.investigationRunId : event.runId;
    if (!overlaps || investigationRunId == null || runIds.includes(investigationRunId)) continue;
    runIds.push(investigationRunId);
    if (runIds.length >= 5) break;
  }
  return runIds;
}

export type InvestigationSeedSymbol = SymbolHint;
export type InvestigationSeedRecentChange = RecentChangedFile;
