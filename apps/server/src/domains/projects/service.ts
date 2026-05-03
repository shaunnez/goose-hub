import { listProjects as readProjects } from '../../shared/projects.js';

/**
 * Returns the list of registered projects (#208). Thin shim today —
 * exists so the router stays a delegator and future shaping (filtering,
 * pagination, response trimming) lands here, not in the route handler.
 */
export async function listProjectsService(): Promise<{ projects: unknown[] }> {
  const projects = await readProjects();
  return { projects };
}
