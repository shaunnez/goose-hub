import { firstProjectRepository } from '@goose-hub/core/projects/repositories.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { LocalDbStateSource } from '@goose-hub/core/state-source/local-db.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';

function compatibilityRepoRef(config: ProjectConfig): string {
  if (config.source.kind === 'github') return config.source.repo;
  return firstProjectRepository(config)?.repoRef ?? `local:${config.id}`;
}

export function createCliStateSource(config: ProjectConfig): StateSource {
  if (config.source.kind === 'local-db') {
    return new LocalDbStateSource(
      config.id,
      compatibilityRepoRef(config),
      undefined,
      config.source.integrations,
    );
  }

  if (config.source.kind === 'github') {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN is required for GitHub-backed projects.');
    }
    return new GitHubLabelsSource(
      config.id,
      config.source.repo,
      token,
      config.source.repo.split('/')[0],
    );
  }

  const sourceKind = (config.source as { kind: string }).kind;
  throw new Error(`Unsupported source kind for ${config.slug}: ${sourceKind}`);
}
