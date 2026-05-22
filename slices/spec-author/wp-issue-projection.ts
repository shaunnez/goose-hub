import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';

type WpProjection = {
  wp: WorkPackage;
  batch: number | null;
  body: string;
};

const PROJECTION_MARKER = '<!-- factory:wp-projection -->';

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None';
}

function acLines(spec: EngineeringSpec): string[] {
  return spec.acceptanceCriteria.map((ac) => {
    const verify = ac.verifyCommand != null ? `\n  - Verify: \`${ac.verifyCommand}\`` : '';
    return `- ${ac.id}: ${ac.statement}${verify}`;
  });
}

function acceptanceCriteriaSection(spec: EngineeringSpec): string {
  const lines = acLines(spec);
  return lines.length > 0 ? lines.join('\n') : '- None';
}

function buildProjectionBody(input: {
  parent: WorkItem;
  spec: EngineeringSpec;
  wp: WorkPackage;
  batch: number | null;
}): string {
  return [
    PROJECTION_MARKER,
    `<!-- factory:wp-projection parent:${input.parent.externalId} wp:${input.wp.id} -->`,
    `Parent issue: #${input.parent.externalId}`,
    `Engineering Spec authority: parent issue #${input.parent.externalId}`,
    '',
    `## Work Package ${input.wp.id}`,
    '',
    `Dependency batch: ${input.batch ?? 'unbatched'}`,
    '',
    '### Owned files',
    bulletList(input.wp.filesOwned.map((path) => `\`${path}\``)),
    '',
    '### Changes',
    input.wp.changes,
    '',
    '### Depends on',
    bulletList(input.wp.dependsOn),
    '',
    '### Acceptance Criteria',
    acceptanceCriteriaSection(input.spec),
    '',
    '### Tracking Rules',
    '- This issue is a projection from the accepted Engineering Spec.',
    '- Do not run grill, write-prd, decompose-issues, or spec-author from this issue.',
    '- Implementation authority remains the parent Engineering Spec.',
  ].join('\n');
}

export function buildWpIssueProjections(input: {
  parent: WorkItem;
  spec: EngineeringSpec;
}): WpProjection[] {
  const batchByWpId = new Map<string, number>();
  for (const batch of input.spec.executionOrder) {
    for (const wpId of batch.wpIds) batchByWpId.set(wpId, batch.batch);
  }

  return input.spec.workPackages.map((wp) => ({
    wp,
    batch: batchByWpId.get(wp.id) ?? null,
    body: buildProjectionBody({
      parent: input.parent,
      spec: input.spec,
      wp,
      batch: batchByWpId.get(wp.id) ?? null,
    }),
  }));
}

function projectionMatches(input: {
  body: string;
  parentExternalId: string;
  wpId: string;
}): boolean {
  return (
    input.body.includes(PROJECTION_MARKER) &&
    input.body.includes(`Parent issue: #${input.parentExternalId}`) &&
    input.body.includes(`## Work Package ${input.wpId}`)
  );
}

async function listExistingProjectionIssues(input: {
  source: StateSource;
  parent: WorkItem;
}): Promise<Map<string, WorkItem>> {
  const existing = new Map<string, WorkItem>();
  const openItems = await input.source.listOpenWork();

  for (const item of openItems) {
    if (!item.body.includes(PROJECTION_MARKER)) continue;
    if (!item.body.includes(`Parent issue: #${input.parent.externalId}`)) continue;
    for (const line of item.body.split('\n')) {
      const match = /^## Work Package (.+)$/.exec(line.trim());
      if (match == null) continue;
      existing.set(match[1], item);
      break;
    }
  }

  return existing;
}

export async function createWpIssueProjections(input: {
  source: StateSource;
  parent: WorkItem;
  spec: EngineeringSpec;
}): Promise<Array<{ wpId: string; childWorkItemId: string; externalId: string }>> {
  const projections = buildWpIssueProjections({ parent: input.parent, spec: input.spec });
  const created: Array<{ wpId: string; childWorkItemId: string; externalId: string }> = [];
  const existing = await listExistingProjectionIssues({
    source: input.source,
    parent: input.parent,
  });

  for (const projection of projections) {
    const existingProjection = existing.get(projection.wp.id);
    if (
      existingProjection != null &&
      projectionMatches({
        body: existingProjection.body,
        parentExternalId: input.parent.externalId,
        wpId: projection.wp.id,
      })
    ) {
      created.push({
        wpId: projection.wp.id,
        childWorkItemId: existingProjection.id,
        externalId: existingProjection.externalId,
      });
      continue;
    }

    const child = await input.source.createIssue({
      title: `[${projection.wp.id}] ${input.parent.title}`,
      body: projection.body,
      type: 'chore',
      priority: input.parent.priority,
      ...(input.parent.milestoneId != null ? { milestoneId: input.parent.milestoneId } : {}),
      initialState: 'factory:issues-created',
      extraLabels: ['factory:from-prd'],
    });
    created.push({
      wpId: projection.wp.id,
      childWorkItemId: child.id,
      externalId: child.externalId,
    });
  }

  return created;
}
