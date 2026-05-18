import { describe, expect, it } from 'vitest';
import { SKILL_BUDGETS } from '../agent-runtime/budgets.js';
import { STATES } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import { targetStateForTriage } from './triage-routing.js';
import { WORKFLOW_CATALOG, type WorkflowCatalogEntry } from './workflow-catalog.js';

const stateSet = new Set<string>(STATES);
const registeredSkillSet = new Set<string>(Object.keys(SKILL_BUDGETS));

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

  it('keeps node ids and normal paths internally consistent', () => {
    for (const entry of WORKFLOW_CATALOG) {
      const ids = entry.nodes.map((node) => node.id);
      expect(new Set(ids).size, `${entry.kind} duplicate node ids`).toBe(ids.length);
      for (const id of entry.normalPath) {
        expect(ids.includes(id), `${entry.kind}:${id} normal path`).toBe(true);
      }
    }
  });
});
