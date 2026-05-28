import { describe, expect, it } from 'vitest';
import type { WorkflowGroup as WebWorkflowGroup } from '../../apps/web/src/lib/types.js';
import { SKILL_BUDGETS } from '../agent-runtime/budgets.js';
import { STATES } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import { targetStateForTriage } from './triage-routing.js';
import {
  WORKFLOW_CATALOG,
  type WorkflowActivationSetting,
  type WorkflowCatalogEntry,
  type WorkflowGroup,
} from './workflow-catalog.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false;
type Assert<T extends true> = T;
const _workflowGroupTypeParity: Assert<Equal<WorkflowGroup, WebWorkflowGroup>> = true;

const stateSet = new Set<string>(STATES);
const registeredSkillSet = new Set<string>(Object.keys(SKILL_BUDGETS));
const knownActivationSettings = new Set<WorkflowActivationSetting>([
  'useInvestigationSwarm',
  'useMultiAgentPipeline',
  'devReview.enabled',
  'review.convergent',
  'workItem.simpleBug',
  'workItem.missingPromotionSeed',
  'priority.highCritical',
  'playwrightRepro.enabled',
  'evidencePost.enabled',
]);

function byKind(kind: WorkflowCatalogEntry['kind']): WorkflowCatalogEntry {
  const entry = WORKFLOW_CATALOG.find((candidate) => candidate.kind === kind);
  if (entry == null) throw new Error(`missing catalog entry for ${kind}`);
  return entry;
}

function hasEdge(entry: WorkflowCatalogEntry, from: string, toState: string): boolean {
  const nodesById = new Map(entry.nodes.map((node) => [node.id, node]));
  return entry.edges.some(
    (edge) => edge.from === from && nodesById.get(edge.to)?.state === toState,
  );
}

describe('workflow catalog', () => {
  it('covers the normal workflow kinds', () => {
    expect(WORKFLOW_CATALOG.map((entry) => entry.kind)).toStrictEqual([
      'bug',
      'feature',
      'chore',
      'research',
    ]);
  });

  it('keeps triage routing assumptions aligned with the runtime route helper', () => {
    expect(targetStateForTriage('bug')).toBe('factory:investigating');
    expect(targetStateForTriage('research')).toBe('factory:research-pending');
    expect(targetStateForTriage('feature')).toBe('factory:grounding');
    expect(targetStateForTriage('feature', ['vague:high'])).toBe('factory:framing');
    expect(targetStateForTriage('chore')).toBe('factory:dev-ready');

    expect(hasEdge(byKind('bug'), 'accepted', targetStateForTriage('bug'))).toBe(true);
    expect(hasEdge(byKind('research'), 'accepted', targetStateForTriage('research'))).toBe(true);
    expect(hasEdge(byKind('feature'), 'accepted', targetStateForTriage('feature'))).toBe(true);
    expect(
      hasEdge(byKind('feature'), 'accepted', targetStateForTriage('feature', ['vague:high'])),
    ).toBe(true);
    expect(hasEdge(byKind('chore'), 'accepted', targetStateForTriage('chore'))).toBe(true);
    expect(targetStateForTriage('feature', ['factory:from-prd'])).toBe('factory:dev-ready');
  });

  it('references only state names from the state-machine registry', () => {
    for (const entry of WORKFLOW_CATALOG) {
      for (const node of entry.nodes) {
        if (node.state != null) {
          expect(stateSet.has(node.state), `${entry.kind}:${node.id} state`).toBe(true);
        }
      }
    }
  });

  it('uses legal state transitions unless an edge is marked virtual', () => {
    for (const entry of WORKFLOW_CATALOG) {
      const nodesById = new Map(entry.nodes.map((node) => [node.id, node]));
      for (const edge of entry.edges) {
        const from = nodesById.get(edge.from);
        const to = nodesById.get(edge.to);
        expect(from, `${entry.kind}:${edge.from}`).toBeDefined();
        expect(to, `${entry.kind}:${edge.to}`).toBeDefined();

        if (edge.virtual || from?.state == null || to?.state == null || from.state === to.state) {
          continue;
        }

        expect(
          isLegalTransition(from.state, to.state),
          `${entry.kind}:${from.state} -> ${to.state}`,
        ).toBe(true);
      }
    }
  });

  it('references only registered runtime skills', () => {
    for (const entry of WORKFLOW_CATALOG) {
      for (const node of entry.nodes) {
        if (node.skill != null) {
          expect(registeredSkillSet.has(node.skill), `${entry.kind}:${node.skill}`).toBe(true);
        }
      }
    }
  });

  it('shows the full bug investigation swarm', () => {
    const bug = byKind('bug');
    const swarm = bug.stages
      .find((stage) => stage.id === 'investigation')
      ?.variants?.find((variant) => variant.id === 'swarm-investigation');
    const nodesById = new Map(bug.nodes.map((node) => [node.id, node]));

    expect(swarm?.nodes.map((nodeId) => nodesById.get(nodeId)?.skill).filter(Boolean)).toEqual([
      'scout-code-path',
      'scout-dependency',
      'scout-pattern',
      'scout-schema',
      'scout-test-inventory',
      'scout-user-journey',
      'wave2-interface-designer',
      'wave2-risk-analyst',
      'investigate',
    ]);
  });

  it('shows the legacy bug acceptance-contract gate before implementation', () => {
    const bug = byKind('bug');
    const delivery = bug.stages.find((stage) => stage.id === 'delivery-router');
    const legacy = delivery?.variants?.find((variant) => variant.id === 'legacy-delivery');
    const simpleBug = delivery?.branches?.find((branch) => branch.id === 'simple-bug-legacy');
    const acceptanceNode = bug.nodes.find((node) => node.id === 'acceptance-contract-skill');

    expect(acceptanceNode).toMatchObject({
      skill: 'acceptance-contract',
      state: 'factory:investigation-complete',
      mode: 'legacy',
    });
    expect(legacy?.nodes).toContain('acceptance-contract-skill');
    expect(simpleBug?.nodes).toContain('acceptance-contract-skill');
    expect(
      bug.edges.some(
        (edge) => edge.from === 'investigation-complete' && edge.to === 'acceptance-contract-skill',
      ),
    ).toBe(true);
  });

  it('shows lazy bug-enhance grounding as a runtime-conditional investigation branch', () => {
    const bug = byKind('bug');
    const investigation = bug.stages.find((stage) => stage.id === 'investigation');
    const branch = investigation?.branches?.find(
      (candidate) => candidate.id === 'lazy-bug-grounding',
    );
    const bugEnhanceNode = bug.nodes.find((node) => node.id === 'bug-enhance-skill');

    expect(bugEnhanceNode).toMatchObject({
      skill: 'bug-enhance',
      state: 'factory:investigating',
      mode: 'conditional',
      activation: {
        setting: 'workItem.missingPromotionSeed',
        value: true,
        label: 'bug issue without promotion seed',
      },
    });
    expect(branch).toMatchObject({
      kind: 'conditional',
      nodes: ['bug-enhance-skill'],
      activation: {
        setting: 'workItem.missingPromotionSeed',
        value: true,
        label: 'bug issue without promotion seed',
      },
    });
  });

  it('represents Grill, PRD, Decompose, Delivery Router, Implementation, Conflict, and Dev Review as distinct stages', () => {
    const feature = byKind('feature');
    expect(feature.stages.map((stage) => stage.id)).toEqual(
      expect.arrayContaining([
        'grill',
        'prd',
        'decompose',
        'delivery-router',
        'implementation',
        'dev-review-advisor',
      ]),
    );
    expect(feature.stages.find((stage) => stage.id === 'grill')?.group).toBe('grill');
    expect(feature.stages.find((stage) => stage.id === 'prd')?.group).toBe('prd');
    expect(feature.stages.find((stage) => stage.id === 'decompose')?.group).toBe('decompose');
    expect(feature.stages.find((stage) => stage.id === 'delivery-router')?.group).toBe(
      'delivery-router',
    );
    expect(feature.stages.find((stage) => stage.id === 'implementation')?.group).toBe(
      'implementation',
    );

    for (const kind of ['bug', 'feature', 'chore'] as const) {
      const entry = byKind(kind);
      expect(entry.stages.find((stage) => stage.id === 'conflict')?.group).toBe('conflict');
      expect(entry.stages.find((stage) => stage.id === 'dev-review-advisor')?.group).toBe(
        'dev-review',
      );
    }
  });

  it('keeps node ids and normal paths internally consistent', () => {
    for (const entry of WORKFLOW_CATALOG) {
      const ids = entry.nodes.map((node) => node.id);
      expect(new Set(ids).size, `${entry.kind} duplicate node ids`).toBe(ids.length);
      for (const id of entry.normalPath) {
        expect(ids.includes(id), `${entry.kind}:${id} normal path`).toBe(true);
      }
    }
  });

  it('keeps vertical stages pointed at known nodes and settings', () => {
    for (const entry of WORKFLOW_CATALOG) {
      const ids = new Set(entry.nodes.map((node) => node.id));
      const stageIds = entry.stages.map((stage) => stage.id);
      expect(new Set(stageIds).size, `${entry.kind} duplicate stage ids`).toBe(stageIds.length);

      for (const stage of entry.stages) {
        for (const nodeId of stage.nodes) {
          expect(ids.has(nodeId), `${entry.kind}:${stage.id}:${nodeId}`).toBe(true);
        }

        for (const variant of stage.variants ?? []) {
          for (const nodeId of variant.nodes) {
            expect(ids.has(nodeId), `${entry.kind}:${stage.id}:${variant.id}:${nodeId}`).toBe(true);
          }
          if (variant.activation != null) {
            expect(
              knownActivationSettings.has(variant.activation.setting),
              `${entry.kind}:${variant.id}:${variant.activation.setting}`,
            ).toBe(true);
          }
        }

        for (const branch of stage.branches ?? []) {
          for (const nodeId of branch.nodes) {
            expect(ids.has(nodeId), `${entry.kind}:${stage.id}:${branch.id}:${nodeId}`).toBe(true);
          }
          if (branch.activation != null) {
            expect(
              knownActivationSettings.has(branch.activation.setting),
              `${entry.kind}:${branch.id}:${branch.activation.setting}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('shows feature PRD approval routing the parent issue to dev-ready before spec-author', () => {
    const feature = byKind('feature');

    expect(feature.normalPath).toEqual(
      expect.arrayContaining(['prd-review', 'dev-ready', 'spec-ready']),
    );
    expect(feature.normalPath.indexOf('prd-review')).toBeLessThan(
      feature.normalPath.indexOf('dev-ready'),
    );
    expect(feature.normalPath).not.toContain('decomposing');
    expect(feature.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'prd-review', to: 'dev-ready', kind: 'primary' }),
        expect.objectContaining({ from: 'prd-review', to: 'decomposing', kind: 'optional' }),
      ]),
    );
  });
});
