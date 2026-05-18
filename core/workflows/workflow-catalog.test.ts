import { describe, expect, it } from 'vitest';
import { SKILL_BUDGETS } from '../agent-runtime/budgets.js';
import { STATES } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import { targetStateForTriage } from './triage-routing.js';
import {
  WORKFLOW_CATALOG,
  type WorkflowActivationSetting,
  type WorkflowCatalogEntry,
} from './workflow-catalog.js';

const stateSet = new Set<string>(STATES);
const registeredSkillSet = new Set<string>(Object.keys(SKILL_BUDGETS));
const knownActivationSettings = new Set<WorkflowActivationSetting>([
  'useInvestigationSwarm',
  'useMultiAgentPipeline',
  'devReview.enabled',
  'review.convergent',
  'workItem.simpleBug',
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
    expect(targetStateForTriage('feature')).toBe('factory:grilling');
    expect(targetStateForTriage('chore')).toBe('factory:dev-ready');

    expect(hasEdge(byKind('bug'), 'accepted', targetStateForTriage('bug'))).toBe(true);
    expect(hasEdge(byKind('research'), 'accepted', targetStateForTriage('research'))).toBe(true);
    expect(hasEdge(byKind('feature'), 'accepted', targetStateForTriage('feature'))).toBe(true);
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
});
