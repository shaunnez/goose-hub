import { getProjectBySlug } from '../../../projects/loader.js';
import { firstProjectRepository } from '../../../projects/repositories.js';
import { GitHubLabelsSource } from '../../../state-source/github-labels.js';
import type { StateSource } from '../../../state-source/interface.js';
import { LocalDbStateSource } from '../../../state-source/local-db.js';

export class GitHubTokenMissingError extends Error {
  readonly kind = 'GitHubTokenMissingError' as const;
  constructor() {
    super(
      'GitHub-backed factory tool requires a token. Set FACTORY_GITHUB_TOKEN or GITHUB_TOKEN in the orchestrator environment.',
    );
    this.name = 'GitHubTokenMissingError';
  }
}

export class ProjectNotFoundError extends Error {
  readonly kind = 'ProjectNotFoundError' as const;
  readonly projectId: string;
  constructor(projectId: string) {
    super(`No project config found for slug '${projectId}'.`);
    this.name = 'ProjectNotFoundError';
    this.projectId = projectId;
  }
}

/**
 * Resolves the GitHub token from the orchestrator's env. Tools must not
 * accept tokens via input — the agent never sees credentials. The
 * `FACTORY_GITHUB_TOKEN` name is preferred so it doesn't collide with a
 * user shell that has `GITHUB_TOKEN` set for other purposes; we fall back
 * to `GITHUB_TOKEN` for compatibility with apps/server's existing config.
 */
export function resolveGitHubToken(): string {
  const token = process.env.FACTORY_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (token == null || token.length === 0) throw new GitHubTokenMissingError();
  return token;
}

/**
 * Builds the configured StateSource for the project the run belongs to.
 * GitHub-backed projects require a token; local-db projects do not.
 */
export async function getStateSourceForProject(projectId: string): Promise<StateSource> {
  const project = await getProjectBySlug(projectId);
  if (project == null) throw new ProjectNotFoundError(projectId);
  const sourceKind = (project.source as { kind: string }).kind;
  if (project.source.kind === 'local-db') {
    const repoRef = firstProjectRepository(project)?.repoRef ?? `local:${project.id}`;
    return new LocalDbStateSource(project.id, repoRef);
  }
  if (project.source.kind !== 'github') {
    throw new Error(
      `getStateSourceForProject: project '${projectId}' has unsupported source.kind='${sourceKind}'.`,
    );
  }
  const token = resolveGitHubToken();
  return new GitHubLabelsSource(project.id, project.source.repo, token);
}
