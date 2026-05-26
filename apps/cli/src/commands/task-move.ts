import { loadProjects } from '@goose-hub/core/projects/loader.js';
import {
  type DepMoveMode,
  type FetchLifecycleFn,
  type SetScheduleFn,
  moveIssueToCurrent,
} from '@goose-hub/core/projects/move-with-deps.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export async function taskMoveCommand(rawArgs: string[]): Promise<void> {
  // goose task move <slug> <issue-id> --to=<schedule> [--with-dependencies | --ignore-dependencies]
  const [slug = '', id = '', ...rest] = rawArgs;
  let to = 'current';
  let withDeps: boolean | null = null;

  for (const arg of rest) {
    if (arg.startsWith('--to=')) to = arg.slice('--to='.length);
    else if (arg === '--with-dependencies') withDeps = true;
    else if (arg === '--ignore-dependencies') withDeps = false;
  }

  if (!slug || !id) {
    console.error(
      'Usage: goose task move <project-slug> <issue-id> --to=<schedule> [--with-dependencies | --ignore-dependencies]',
    );
    process.exit(1);
  }

  if (to !== 'current') {
    console.error(`Only --to=current is supported. Got: --to=${to}`);
    process.exit(1);
  }

  const projects = await loadProjects(targetProjectsRoot);
  const config = projects.find((p) => p.slug === slug);
  if (!config) {
    console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  if (config.source.kind !== 'github') {
    console.error(
      `goose task move currently supports github-labels projects only. ${slug} uses ${config.source.kind}.`,
    );
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);
  let item: WorkItem;
  try {
    item = await source.getItem(id);
  } catch (err) {
    console.error(`Failed to fetch issue #${id}: ${(err as Error).message}`);
    process.exit(1);
  }

  const hasDeps = item.dependsOn.length > 0;
  if (hasDeps && withDeps === null) {
    console.error(
      `Issue #${id} has dependencies. Choose one:\n  --with-dependencies   Move issue and all open deps\n  --ignore-dependencies Move issue only`,
    );
    process.exit(1);
  }

  const mode: DepMoveMode = withDeps === false ? 'ignore-dependencies' : 'with-dependencies';

  const fetchLifecycle: FetchLifecycleFn = async (repoRef, issueNumber) => {
    const url = `https://api.github.com/repos/${repoRef}/issues/${issueNumber}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) return 'open';
      const json = (await res.json()) as { state: 'open' | 'closed' };
      return json.state;
    } catch {
      return 'open';
    }
  };

  const setSchedule: SetScheduleFn = async (repoRef, issueNumber, schedule) => {
    const depSource = new GitHubLabelsSource(config.id, repoRef, token);
    await depSource.setLabelInGroup(String(issueNumber), 'schedule', schedule);
  };

  let result: Awaited<ReturnType<typeof moveIssueToCurrent>>;
  try {
    result = await moveIssueToCurrent(
      item.body,
      config.source.repo,
      Number(item.externalId),
      mode,
      fetchLifecycle,
      setSchedule,
    );
  } catch (err) {
    console.error(`Move failed: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Moved #${id} to schedule:current.`);
  if (result.depsMoved.length > 0) {
    console.log('\nAlso moved dependencies:');
    for (const dep of result.depsMoved) {
      console.log(`  ${dep.repoRef}#${dep.issueNumber}`);
    }
  }
  if (result.depsSkipped.length > 0) {
    console.log('\nSkipped (closed or ignored):');
    for (const dep of result.depsSkipped) {
      console.log(`  ${dep.repoRef}#${dep.issueNumber} [${dep.lifecycle}]`);
    }
  }
}
