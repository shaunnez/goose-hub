import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
/**
 * M13.06 — decompose-prd workflow slice tests.
 *
 * Tests the runDecomposePrdWorkflow using an InMemoryLabelsSource and injected
 * AgentRuntime mock. Covers:
 *   1. Single-slice PRD: one child issue created, parent transitions to factory:issues-created.
 *   2. Multi-slice PRD with sequential deps: sibling index refs are resolved to real numbers.
 *   3. Duplicate-title guard: two children with same title → factory:needs-human + comment.
 *   4. Schema-validation failure: malformed runtime output → factory:needs-human.
 */
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  resolveSiblingRefs,
  runDecomposePrdWorkflow,
} from '@goose-hub/core/workflows/decompose-prd.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = 'test-project';
const REPO_REF = 'test-owner/test-repo';

function makeParentItem(externalId = '100'): WorkItem {
  return {
    id: `github:${REPO_REF}#${externalId}`,
    externalId,
    repoRef: REPO_REF,
    title: 'Parent PRD epic',
    body: 'A big feature requiring decomposition.',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:prd-review',
    authorIsOwner: true,
    milestoneId: '1',
    milestoneTitle: 'M13',
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
  };
}

function makeRuntime(output: unknown): AgentRuntime {
  return {
    run: vi.fn().mockResolvedValue({
      output,
      decisionSummaries: [],
      events: [],
    }),
  };
}

function makeValidOutput(
  issues: Array<{ title: string; body: string; labels?: string[]; dependsOn?: number[] }>,
) {
  return {
    issues: issues.map((i) => ({
      title: i.title,
      body: i.body,
      labels: i.labels ?? [
        'factory:accepted',
        'type:feature',
        'priority:medium',
        'schedule:current',
        'exec:serial',
      ],
      dependsOn: i.dependsOn ?? [],
    })),
    decisionSummaries: [
      { kind: 'PLAN', summary: 'Decomposed PRD into slices' },
      { kind: 'VERDICT', summary: 'Final issue list produced' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. Single-slice PRD
// ---------------------------------------------------------------------------

describe('single-slice PRD', () => {
  it('creates one child issue and transitions parent to factory:issues-created', async () => {
    const source = new InMemoryLabelsSource(PROJECT_ID, REPO_REF);
    const parent = await source.seedIssue({
      title: 'Parent PRD epic',
      body: 'A big feature.',
      state: 'factory:prd-review',
    });

    const workItem = makeParentItem(parent.externalId);
    const output = makeValidOutput([
      {
        title: 'M13.01: implement core schema',
        body: 'Create the schema.\n\n## Depends on\n\nNo prior sibling dependencies.',
      },
    ]);

    await runDecomposePrdWorkflow({
      workItem,
      prdOutput: { slices: [] },
      stateSource: source,
      projectId: PROJECT_ID,
      deps: { runtime: makeRuntime(output) },
    });

    // Parent should be in factory:issues-created
    const updatedParent = await source.getItem(parent.externalId);
    expect(updatedParent.state).toBe('factory:issues-created');

    // One child issue should have been created
    const allItems = await source.listOpenWork();
    const children = allItems.filter((i) => i.externalId !== parent.externalId);
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe('M13.01: implement core schema');

    // Parent should have a comment listing the child
    const comments = await source.listComments(parent.externalId);
    const childComment = comments.find((c) => c.body.includes('## Child issues'));
    expect(childComment).toBeDefined();
    expect(childComment?.body).toContain(`#${children[0].externalId}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-slice PRD with sequential deps
// ---------------------------------------------------------------------------

describe('multi-slice PRD with sequential sibling deps', () => {
  it('resolves sibling index refs to real issue numbers in child bodies', async () => {
    const source = new InMemoryLabelsSource(PROJECT_ID, REPO_REF);
    const parent = await source.seedIssue({
      title: 'Parent PRD epic',
      body: 'A feature requiring 3 slices.',
      state: 'factory:prd-review',
    });

    const workItem = makeParentItem(parent.externalId);

    // 3-issue chain: issue[1] depends on issue[0], issue[2] depends on issue[1]
    const output = makeValidOutput([
      {
        title: 'M13.01: slice zero',
        body: '## Context\nFirst slice.\n\n## Acceptance criteria\n- [ ] Done\n\n## Depends on\n\nNo prior sibling dependencies.',
        dependsOn: [],
      },
      {
        title: 'M13.02: slice one',
        body: '## Context\nSecond slice.\n\n## Acceptance criteria\n- [ ] Done\n\n## Depends on\n\n- Depends on (sibling index 0): must complete first',
        dependsOn: [0],
      },
      {
        title: 'M13.03: slice two',
        body: '## Context\nThird slice.\n\n## Acceptance criteria\n- [ ] Done\n\n## Depends on\n\n- Depends on (sibling index 1): sequential dependency',
        dependsOn: [1],
      },
    ]);

    const result = await runDecomposePrdWorkflow({
      workItem,
      prdOutput: { slices: [] },
      stateSource: source,
      projectId: PROJECT_ID,
      deps: { runtime: makeRuntime(output) },
    });

    expect(result.childIssueNumbers).toHaveLength(3);

    const [n0, n1, n2] = result.childIssueNumbers;

    // Issue 1's body should contain the real number of issue 0
    const child1 = await source.getItem(String(n1));
    expect(child1.body).toContain(`#${n0}`);
    expect(child1.body).not.toContain('sibling index');

    // Issue 2's body should contain the real number of issue 1
    const child2 = await source.getItem(String(n2));
    expect(child2.body).toContain(`#${n1}`);
    expect(child2.body).not.toContain('sibling index');

    // Parent transitions to factory:issues-created
    const updatedParent = await source.getItem(parent.externalId);
    expect(updatedParent.state).toBe('factory:issues-created');
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate-title guard
// ---------------------------------------------------------------------------

describe('duplicate-title guard', () => {
  it('transitions parent to factory:needs-human and posts a comment; no children created', async () => {
    const source = new InMemoryLabelsSource(PROJECT_ID, REPO_REF);
    const parent = await source.seedIssue({
      title: 'Parent PRD epic',
      body: 'Feature with duplicate slice titles.',
      state: 'factory:prd-review',
    });

    const workItem = makeParentItem(parent.externalId);

    const output = makeValidOutput([
      { title: 'M13.01: duplicate title', body: 'First slice.', dependsOn: [] },
      { title: 'M13.01: duplicate title', body: 'Second slice with same title.', dependsOn: [] },
    ]);

    const result = await runDecomposePrdWorkflow({
      workItem,
      prdOutput: { slices: [] },
      stateSource: source,
      projectId: PROJECT_ID,
      deps: { runtime: makeRuntime(output) },
    });

    // No child issues should have been created
    expect(result.childIssueNumbers).toHaveLength(0);

    // Parent should be in factory:needs-human
    const updatedParent = await source.getItem(parent.externalId);
    expect(updatedParent.state).toBe('factory:needs-human');

    // A comment should have been posted explaining the duplicate
    const comments = await source.listComments(parent.externalId);
    const dupComment = comments.find((c) => c.body.toLowerCase().includes('duplicate'));
    expect(dupComment).toBeDefined();

    // No new issues beyond the parent
    const allItems = await source.listOpenWork();
    const children = allItems.filter((i) => i.externalId !== parent.externalId);
    expect(children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Schema-validation failure
// ---------------------------------------------------------------------------

describe('schema-validation failure', () => {
  it('transitions parent to factory:needs-human when runtime output is malformed', async () => {
    const source = new InMemoryLabelsSource(PROJECT_ID, REPO_REF);
    const parent = await source.seedIssue({
      title: 'Parent PRD epic',
      body: 'Feature.',
      state: 'factory:prd-review',
    });

    const workItem = makeParentItem(parent.externalId);

    // Malformed output: decisionSummaries is missing (required by schema)
    const malformedOutput = {
      issues: [{ title: 'ok', body: 'body', labels: [], dependsOn: [] }],
      // decisionSummaries is intentionally missing
    };

    const result = await runDecomposePrdWorkflow({
      workItem,
      prdOutput: { slices: [] },
      stateSource: source,
      projectId: PROJECT_ID,
      deps: { runtime: makeRuntime(malformedOutput) },
    });

    expect(result.childIssueNumbers).toHaveLength(0);

    const updatedParent = await source.getItem(parent.externalId);
    expect(updatedParent.state).toBe('factory:needs-human');
  });
});

// ---------------------------------------------------------------------------
// 5. Unit tests for resolveSiblingRefs helper
// ---------------------------------------------------------------------------

describe('resolveSiblingRefs', () => {
  it('replaces (sibling index N) with real issue number', () => {
    const map = new Map([
      [0, 42],
      [1, 43],
    ]);
    const body = 'Depends on (sibling index 0): must finish first\nAlso (sibling index 1)';
    const result = resolveSiblingRefs(body, map);
    expect(result).toContain('#42');
    expect(result).toContain('#43');
    expect(result).not.toContain('sibling index');
  });

  it('replaces #sibling:N with real issue number', () => {
    const map = new Map([[0, 100]]);
    const body = 'Blocked by #sibling:0';
    const result = resolveSiblingRefs(body, map);
    expect(result).toBe('Blocked by #100');
  });

  it('leaves unresolved placeholders unchanged when index not in map', () => {
    const map = new Map([[0, 42]]);
    const body = 'Depends on (sibling index 5)';
    const result = resolveSiblingRefs(body, map);
    expect(result).toBe(body);
  });

  it('is case-insensitive', () => {
    const map = new Map([[0, 99]]);
    const body = 'Depends on (SIBLING INDEX 0)';
    const result = resolveSiblingRefs(body, map);
    expect(result).toBe('Depends on #99');
  });
});
