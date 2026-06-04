import type { ProjectConfig } from '../types.js';
import { listProjectRepositories } from './repositories.js';

const DESCRIPTION_PREFIX = '**Description:**';

export function parseRepoDescriptions(markdown: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  let currentRepoRef: string | null = null;

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^###\s+\[([^\]]+)\]/);
    if (heading) {
      currentRepoRef = heading[1].trim();
      continue;
    }

    if (currentRepoRef != null && line.startsWith(DESCRIPTION_PREFIX)) {
      const description = line.slice(DESCRIPTION_PREFIX.length).trim();
      if (description.length > 0) descriptions.set(currentRepoRef, description);
      currentRepoRef = null;
    }
  }

  return descriptions;
}

export function buildRepoRegistryContext(project: ProjectConfig, reposMd = ''): string {
  const descriptions = parseRepoDescriptions(reposMd);
  const repositories = listProjectRepositories(project);

  return repositories
    .map((repo) => {
      const description = descriptions.get(repo.repoRef) ?? `${repo.repoRef} managed by Factory.`;
      return [
        `### [${repo.repoRef}](https://github.com/${repo.repoRef})`,
        `**Default branch:** \`${repo.defaultBranch}\``,
        `**Description:** ${description}`,
      ].join('\n');
    })
    .join('\n\n');
}
