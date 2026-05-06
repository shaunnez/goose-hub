import {
  CrossRunRetroInputError,
  runCrossRunRetroWorkflow,
} from '@goose-hub/core/workflows/cross-run-retro.js';
import type { Result } from '#shared/middleware.js';
import { type PlaybookRow, getPlaybookById, listPlaybooksForProject } from './repository.js';

export interface PlaybookSummaryDto {
  id: number;
  projectId: string;
  windowStartAt: string;
  windowEndAt: string;
  lifecycleCount: number;
  topPatternCount: number;
  topCandidateCount: number;
  createdAt: string;
}

export interface PlaybookDetailDto extends PlaybookSummaryDto {
  manifest: unknown;
}

interface ManifestShape {
  topPatterns?: unknown[];
  improvementCandidates?: unknown[];
}

function parseManifest(raw: string): ManifestShape {
  try {
    return JSON.parse(raw) as ManifestShape;
  } catch {
    return {};
  }
}

function toSummary(row: PlaybookRow): PlaybookSummaryDto {
  const manifest = parseManifest(row.manifest);
  return {
    id: row.id,
    projectId: row.projectId,
    windowStartAt: row.windowStartAt,
    windowEndAt: row.windowEndAt,
    lifecycleCount: row.lifecycleCount,
    topPatternCount: Array.isArray(manifest.topPatterns) ? manifest.topPatterns.length : 0,
    topCandidateCount: Array.isArray(manifest.improvementCandidates)
      ? manifest.improvementCandidates.length
      : 0,
    createdAt: row.createdAt,
  };
}

export async function listPlaybooks(
  projectId: string,
): Promise<Result<{ playbooks: PlaybookSummaryDto[] }>> {
  const rows = await listPlaybooksForProject(projectId);
  return { ok: true, data: { playbooks: rows.map(toSummary) } };
}

export async function getPlaybook(id: number): Promise<Result<{ playbook: PlaybookDetailDto }>> {
  const row = await getPlaybookById(id);
  if (!row) return { ok: false, error: 'playbook not found', status: 404 };
  const manifest = parseManifest(row.manifest);
  return {
    ok: true,
    data: {
      playbook: {
        ...toSummary(row),
        manifest,
      },
    },
  };
}

export interface CreatePlaybookInput {
  windowSize?: number;
  dateRange?: { startAt: string; endAt: string };
}

export async function createPlaybook(
  projectId: string,
  input: CreatePlaybookInput,
): Promise<Result<{ playbookId: number; lifecycleCount: number }>> {
  try {
    const result = await runCrossRunRetroWorkflow({
      projectId,
      windowSize: input.windowSize,
      dateRange: input.dateRange,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, status: 500 };
    }
    return {
      ok: true,
      data: { playbookId: result.playbookId, lifecycleCount: result.lifecycleCount },
    };
  } catch (err) {
    if (err instanceof CrossRunRetroInputError) {
      return { ok: false, error: err.message, status: 400 };
    }
    return { ok: false, error: String(err), status: 500 };
  }
}
