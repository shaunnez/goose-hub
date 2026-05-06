import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { runCrossRunRetroWorkflow } from '@goose-hub/core/workflows/cross-run-retro.js';

export interface CreatePlaybookRequest {
  windowSize?: 'day' | 'week' | 'month';
  dateRange?: {
    startAt: string;
    endAt: string;
  };
}

export async function createPlaybookService(
  projectSlug: string,
  req: CreatePlaybookRequest,
): Promise<{ ok: boolean; data?: unknown; error?: string; status?: number }> {
  try {
    const project = await getProjectBySlug(projectSlug);
    if (!project) {
      return { ok: false, error: 'Project not found', status: 404 };
    }

    // Validate input
    if (!req.windowSize && !req.dateRange) {
      return {
        ok: false,
        error: 'Either windowSize or dateRange must be provided',
        status: 400,
      };
    }

    // Dispatch the cross-run retro workflow
    await runCrossRunRetroWorkflow({
      projectId: project.id,
      windowSize: req.windowSize,
      windowDateRange: req.dateRange,
    });

    return { ok: true, data: { status: 'playbook-generation-started' } };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to create playbook: ${String(err)}`,
      status: 500,
    };
  }
}
