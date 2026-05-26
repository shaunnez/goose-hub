import { db } from '@goose-hub/core/db/db.js';
import { agentRunCosts } from '@goose-hub/core/db/schema.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import { and, eq, gte, lt } from 'drizzle-orm';

export async function statusCommand(slug: string): Promise<void> {
  const projects = await loadProjects(targetProjectsRoot);
  const knownSlugs = projects.map((p) => p.slug).join(', ');

  if (!slug) {
    console.error('Usage: goose status <project-slug>');
    console.error(`Known projects: ${knownSlugs}`);
    process.exit(1);
  }

  const config = projects.find((p) => p.slug === slug);
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${knownSlugs}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  if (config.source.kind !== 'github') {
    console.error(
      `goose status currently supports github-labels projects only. ${slug} uses ${config.source.kind}.`,
    );
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);

  let items: WorkItem[];
  let milestoneLabel: string | null = null;
  let milestoneNumber: number | null = null;

  try {
    if (config.activeMilestone != null) {
      // Per-project config takes priority over GitHub's default active milestone.
      milestoneLabel = config.activeMilestone;
      const milestones = await source.listMilestones();
      const match = milestones.find((m) => m.title === config.activeMilestone);
      milestoneNumber = match?.number ?? null;
    } else {
      const milestone = await source.getActiveMilestone();
      if (milestone != null) {
        milestoneLabel = milestone.title;
        milestoneNumber = milestone.number;
      }
    }
    items = await source.listOpenWork(milestoneNumber ?? undefined);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`${config.name} (${config.source.repo})`);
  if (milestoneLabel) {
    console.log(`Active milestone: ${milestoneLabel}`);
  }
  console.log('─'.repeat(70));

  const byState = new Map<StateName, WorkItem[]>();
  for (const item of items) {
    const group = byState.get(item.state) ?? [];
    group.push(item);
    byState.set(item.state, group);
  }

  for (const state of STATES) {
    const group = byState.get(state);
    if (!group || group.length === 0) continue;
    console.log(`\n  ${state} (${group.length})`);
    for (const item of group) {
      const num = `#${item.externalId}`.padStart(5);
      const title = item.title.slice(0, 55);
      console.log(`     ${num}  ${title}`);
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Total: ${items.length} open issue${items.length !== 1 ? 's' : ''}`);

  // Per-project daily budget usage
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({
        costUsd: agentRunCosts.costUsd,
        inputTokens: agentRunCosts.inputTokens,
        outputTokens: agentRunCosts.outputTokens,
      })
      .from(agentRunCosts)
      .where(
        and(
          eq(agentRunCosts.projectId, config.id),
          gte(agentRunCosts.createdAt, `${today}T00:00:00Z`),
          lt(agentRunCosts.createdAt, `${tomorrow}T00:00:00Z`),
        ),
      );
    const totalCostUsd = rows.reduce((acc, r) => acc + r.costUsd, 0);
    const totalTokens = rows.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
    const limitTokens = config.budgets.dailyTokens;
    console.log(
      `\nBudget (today): $${totalCostUsd.toFixed(4)} · ${totalTokens.toLocaleString()} / ${limitTokens.toLocaleString()} tokens${totalTokens >= limitTokens && limitTokens > 0 ? '  ⚠ EXCEEDED' : ''}`,
    );
  } catch {
    // DB may not be initialised in CI or dry-run environments — silently skip
  }
}
